import type {
  DailyMonitorStatistic,
  FailureType,
  Statistics,
  StatisticsPoint,
  StatisticsSeries,
} from '../db/models';

type DetailedCheck = {
  checked_at: string;
  success: boolean;
  response_ms: number | null;
  http_status: number | null;
  failure_type: FailureType | null;
};

/**
 * Creates the chart-ready view shared by the dashboard and the PDF report.
 * Old dates come from permanent daily summaries; recent dates retain their
 * detailed checks. Failure/status distributions are deliberately limited to
 * detailed checks, because that is the data retained for those dimensions.
 */
export function buildStatisticsSeries(
  summary: Statistics,
  dailyStats: DailyMonitorStatistic[],
  recentChecks: DetailedCheck[],
  incidents: StatisticsSeries['incidents'] = [],
): StatisticsSeries {
  const byDate = new Map<string, StatisticsPoint>();

  for (const day of dailyStats) {
    byDate.set(day.stat_date, {
      date: day.stat_date,
      totalChecks: day.total_checks,
      successfulChecks: day.successful_checks,
      failedChecks: day.failed_checks,
      uptimePercentage: day.uptime_percentage,
      averageResponseMs: day.avg_response_ms,
      incidentCount: day.incident_count,
      downtimeSeconds: day.total_downtime_seconds,
    });
  }

  /*
   * Recent raw checks are authoritative for their dates.
   *
   * This prevents a daily summary and raw checks from being added
   * together when both happen to contain the same date.
   */
  const recentByDate = new Map<string, DetailedCheck[]>();

  for (const check of recentChecks) {
    const date = check.checked_at.slice(0, 10);
    const checks = recentByDate.get(date) ?? [];
    checks.push(check);
    recentByDate.set(date, checks);
  }

  for (const [date, checks] of recentByDate) {
    const successfulChecks = checks.filter(
      (check) => check.success,
    ).length;

    const responseTimes = checks
      .map((check) => check.response_ms)
      .filter((value): value is number => value !== null);

    byDate.set(date, {
      date,
      totalChecks: checks.length,
      successfulChecks,
      failedChecks: checks.length - successfulChecks,
      uptimePercentage: Number(
        ((successfulChecks / checks.length) * 100).toFixed(2),
      ),
      averageResponseMs: responseTimes.length
        ? Math.round(
          responseTimes.reduce((a, b) => a + b, 0) /
          responseTimes.length,
        )
        : null,
      incidentCount:
        byDate.get(date)?.incidentCount ?? 0,
      downtimeSeconds:
        byDate.get(date)?.downtimeSeconds ?? 0,
    });
  }

  const count = <T extends string | number | null>(
    values: T[],
  ) =>
    [
      ...values.reduce(
        (map, value) =>
          map.set(value, (map.get(value) ?? 0) + 1),
        new Map<T, number>(),
      ),
    ].map(([value, count]) => ({ value, count }));

  return {
    summary,
    points: [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),

    failureTypes: count(
      recentChecks
        .filter(
          (
            check,
          ): check is DetailedCheck & {
            failure_type: FailureType;
          } => check.failure_type !== null,
        )
        .map((check) => check.failure_type),
    ).map(({ value: type, count }) => ({
      type,
      count,
    })),

    httpStatuses: count(
      recentChecks.map((check) => check.http_status),
    )
      .map(({ value: status, count }) => ({
        status,
        count,
      }))
      .sort(
        (a, b) => (a.status ?? 999) - (b.status ?? 999),
      ),
    incidents, // incidents are not included in the chart-ready series
  };
}

/**
 * Pure, deterministic statistics calculation from a flat list of raw
 * checks and incidents. Retained as-is (and still independently
 * testable without a live Supabase connection) for existing callers
 * and tests. New code should prefer combineStatistics(), which also
 * knows how to fold in permanent daily_monitor_statistics rows and
 * correctly clips incident duration to a requested range.
 */
export function calculateStatistics(
  checks: Array<{
    success: boolean;
    response_ms: number | null;
  }>,
  incidents: Array<{
    duration_seconds: number | null;
  }>,
): Statistics {
  const totalChecks = checks.length;

  const successfulChecks = checks.filter(
    (x) => x.success,
  ).length;

  const times = checks
    .map((x) => x.response_ms)
    .filter((x): x is number => x !== null);

  const failedChecks = totalChecks - successfulChecks;

  return {
    totalChecks,
    successfulChecks,
    failedChecks,

    uptimePercentage: totalChecks
      ? Number(
        ((successfulChecks / totalChecks) * 100).toFixed(2),
      )
      : 0,

    averageResponseMs: times.length
      ? Math.round(
        times.reduce((a, b) => a + b, 0) / times.length,
      )
      : null,

    minimumResponseMs: times.length
      ? Math.min(...times)
      : null,

    maximumResponseMs: times.length
      ? Math.max(...times)
      : null,

    incidentCount: incidents.length,

    totalDowntimeSeconds: incidents.reduce(
      (sum, x) => sum + (x.duration_seconds ?? 0),
      0,
    ),
  };
}

interface RecentIncidentRow {
  started_at: string;
  resolved_at: string | null;
  confirmed_at: string;
}

export interface CombineStatisticsInput {
  /**
   * Permanent per-day summaries for any requested dates older than the
   * 30-day raw retention boundary. Pass [] if the whole requested
   * range is recent.
   */
  dailyStats: DailyMonitorStatistic[];

  /**
   * Raw check_results rows for dates on/after the retention boundary.
   * Pass [] if the whole requested range is historical.
   */
  recentChecks: Array<{
    success: boolean;
    response_ms: number | null;
  }>;

  /**
   * Incidents overlapping [recentRangeStart, recentRangeEnd] (see
   * MonitorRepository.incidentsInRange). Pass [] if the whole
   * requested range is historical.
   */
  recentIncidents: RecentIncidentRow[];

  /** Inclusive UTC date (YYYY-MM-DD): first date NOT covered by dailyStats. */
  recentRangeStart: string;

  /** Inclusive UTC date (YYYY-MM-DD): same as the requested `to`. */
  recentRangeEnd: string;
}

/**
 * Merges permanent daily aggregates with detailed recent records into
 * one Statistics result, without double-counting:
 *
 *  - dailyStats already contains one incident_count/total_downtime
 *    figure per historical day (computed identically to the logic
 *    below, at retention time), so those are summed as-is.
 *  - recentIncidents are only counted/clipped against
 *    [recentRangeStart, recentRangeEnd] — the portion of the request
 *    NOT already represented by dailyStats — so an incident spanning
 *    both a historical and a recent day contributes its historical
 *    portion via dailyStats and only its recent portion here.
 *  - Incident *count* is attributed to the incident's confirmed_at
 *    date (matching the retention aggregation's convention); incident
 *    *downtime* is clipped to the overlap between
 *    [started_at, resolved_at ?? now()] and the recent range.
 *
 * This function is pure and deterministic: given the same inputs, it
 * always produces the same output, so it can be unit tested without a
 * live Supabase connection.
 */
export function combineStatistics(
  input: CombineStatisticsInput,
): Statistics {
  const {
    dailyStats,
    recentChecks,
    recentIncidents,
    recentRangeStart,
    recentRangeEnd,
  } = input;

  let totalChecks = 0;
  let successfulChecks = 0;
  let incidentCount = 0;
  let totalDowntimeSeconds = 0;

  // Response times are merged as a weighted average using each day's
  // total_checks as the weight. daily_monitor_statistics only stores
  // an average per day, not the underlying sample count of non-null
  // response times, so this is a documented approximation once raw
  // rows for that day have been pruned — it will not exactly match
  // what the original raw data would have produced, but it converges
  // to it and never affects correctness of counts/uptime/incidents.
  let responseWeightedSum = 0;
  let responseWeightedCount = 0;
  let minResponse: number | null = null;
  let maxResponse: number | null = null;

  for (const day of dailyStats) {
    totalChecks += day.total_checks;
    successfulChecks += day.successful_checks;
    incidentCount += day.incident_count;
    totalDowntimeSeconds += day.total_downtime_seconds;

    if (day.avg_response_ms !== null) {
      responseWeightedSum += day.avg_response_ms * day.total_checks;
      responseWeightedCount += day.total_checks;
    }
    if (day.min_response_ms !== null) {
      minResponse =
        minResponse === null
          ? day.min_response_ms
          : Math.min(minResponse, day.min_response_ms);
    }
    if (day.max_response_ms !== null) {
      maxResponse =
        maxResponse === null
          ? day.max_response_ms
          : Math.max(maxResponse, day.max_response_ms);
    }
  }

  totalChecks += recentChecks.length;
  const recentSuccessful = recentChecks.filter(
    (check) => check.success,
  ).length;
  successfulChecks += recentSuccessful;

  const recentTimes = recentChecks
    .map((check) => check.response_ms)
    .filter((value): value is number => value !== null);

  if (recentTimes.length) {
    responseWeightedSum += recentTimes.reduce(
      (a, b) => a + b,
      0,
    );
    responseWeightedCount += recentTimes.length;

    const recentMin = Math.min(...recentTimes);
    const recentMax = Math.max(...recentTimes);

    minResponse =
      minResponse === null
        ? recentMin
        : Math.min(minResponse, recentMin);
    maxResponse =
      maxResponse === null
        ? recentMax
        : Math.max(maxResponse, recentMax);
  }

  const rangeStartMs = Date.parse(
    `${recentRangeStart}T00:00:00.000Z`,
  );
  const rangeEndMs =
    Date.parse(`${recentRangeEnd}T00:00:00.000Z`) + 86_400_000;

  for (const incident of recentIncidents) {
    const confirmedDate = incident.confirmed_at.slice(0, 10);

    if (
      confirmedDate >= recentRangeStart &&
      confirmedDate <= recentRangeEnd
    ) {
      incidentCount += 1;
    }

    const overlapStart = Math.max(
      Date.parse(incident.started_at),
      rangeStartMs,
    );
    const overlapEnd = Math.min(
      incident.resolved_at
        ? Date.parse(incident.resolved_at)
        : Date.now(),
      rangeEndMs,
    );

    if (overlapEnd > overlapStart) {
      totalDowntimeSeconds += Math.floor(
        (overlapEnd - overlapStart) / 1000,
      );
    }
  }

  const failedChecks = totalChecks - successfulChecks;

  return {
    totalChecks,
    successfulChecks,
    failedChecks,

    uptimePercentage: totalChecks
      ? Number(
        ((successfulChecks / totalChecks) * 100).toFixed(2),
      )
      : 0,

    averageResponseMs: responseWeightedCount
      ? Math.round(responseWeightedSum / responseWeightedCount)
      : null,

    minimumResponseMs: minResponse,
    maximumResponseMs: maxResponse,

    incidentCount,
    totalDowntimeSeconds,
  };
}
