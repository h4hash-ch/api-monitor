import { describe, expect, it } from 'vitest';
import {
  calculateStatistics,
  combineStatistics,
  buildStatisticsSeries,
} from '../src/services/statistics-service';

describe('statistics', () => {
  it('calculates uptime and response range deterministically', () => {
    expect(
      calculateStatistics(
        [
          { success: true, response_ms: 100 },
          { success: false, response_ms: 300 },
          { success: true, response_ms: null },
        ],
        [{ duration_seconds: 12 }],
      ),
    ).toMatchObject({
      totalChecks: 3,
      successfulChecks: 2,
      failedChecks: 1,
      uptimePercentage: 66.67,
      averageResponseMs: 200,
      minimumResponseMs: 100,
      maximumResponseMs: 300,
      totalDowntimeSeconds: 12,
    });
  });

  it('builds chart points and response/failure distributions from detailed checks', () => {
    const series = buildStatisticsSeries(
      calculateStatistics([{ success: true, response_ms: 120 }], []),
      [],
      [{
        checked_at: '2026-08-20T12:00:00.000Z', success: false,
        response_ms: 250, http_status: 503, failure_type: 'HTTP_ERROR',
      }, {
        checked_at: '2026-08-20T12:05:00.000Z', success: true,
        response_ms: 100, http_status: 200, failure_type: null,
      }],
    );

    expect(series.points).toMatchObject([{
      date: '2026-08-20', totalChecks: 2, successfulChecks: 1,
      failedChecks: 1, averageResponseMs: 175,
    }]);
    expect(series.failureTypes).toEqual([{ type: 'HTTP_ERROR', count: 1 }]);
    expect(series.httpStatuses).toEqual([
      { status: 200, count: 1 }, { status: 503, count: 1 },
    ]);
  });

  it('merges retained daily history with recent data without double counting', () => {
    const stats = combineStatistics({
      dailyStats: [{
        monitor_id: 'monitor',
        stat_date: '2026-01-01',
        total_checks: 10,
        successful_checks: 9,
        failed_checks: 1,
        uptime_percentage: 90,
        avg_response_ms: 100,
        min_response_ms: 50,
        max_response_ms: 200,
        incident_count: 1,
        total_downtime_seconds: 120,
      }],
      recentChecks: [
        { success: true, response_ms: 300 },
        { success: false, response_ms: null },
      ],
      recentIncidents: [{
        started_at: '2026-02-01T23:59:00.000Z',
        confirmed_at: '2026-02-01T23:59:30.000Z',
        resolved_at: '2026-02-02T00:01:00.000Z',
      }],
      recentRangeStart: '2026-02-01',
      recentRangeEnd: '2026-02-02',
    });

    expect(stats).toMatchObject({
      totalChecks: 12,
      successfulChecks: 10,
      failedChecks: 2,
      incidentCount: 2,
      totalDowntimeSeconds: 240,
      minimumResponseMs: 50,
      maximumResponseMs: 300,
    });
  });
});
