import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../env';
import { authenticatedUser, serviceClient } from '../lib/auth';
import { AppError, errorResponse } from '../lib/errors';
import { enforceRateLimit } from '../lib/limit';
import {
  monitorInput,
  monitorPatch,
  reportQuery,
} from '../lib/validation';
import { MonitorRepository } from '../repositories/monitor-repository';
import { checkMonitor } from '../services/monitoring-engine';
import { applyCheckTransition } from '../services/incident-service';
import {
  buildStatisticsSeries,
  combineStatistics,
} from '../services/statistics-service';
import { makePdfReport } from '../services/report-service';
import { WorkerCache } from '../lib/cache';
import { notify } from '../services/notification-service';

export const api = new Hono<{ Bindings: Env }>();

api.use('*', async (c, next) => {
  try {
    await next();
  } catch (error) {
    const formatted = errorResponse(error);
    console.error('Unhandled API error', {
      status: formatted.status,
      code: formatted.body.error.code,
    });
    return c.json(
      formatted.body,
      formatted.status as ContentfulStatusCode,
    );
  }
});

type ApiContext = Context<{ Bindings: Env }>;

async function context(c: ApiContext) {
  const user = await authenticatedUser(c.req.raw, c.env);
  enforceRateLimit(user.id);

  const db = serviceClient(c.env);

  return {
    user,
    db,
    repo: new MonitorRepository(db),
  };
}

/**
 * The oldest UTC calendar date for which raw check_results rows are
 * still guaranteed to exist. This mirrors the day-aligned cutoff used
 * by aggregate_and_delete_expired_checks() in the database: any date
 * strictly before this boundary has already been folded into
 * daily_monitor_statistics and its raw rows deleted. Any date on or
 * after this boundary may still have raw rows.
 *
 * Keeping this calculation in sync with the SQL cutoff is what allows
 * the statistics layer to know which data source to trust for which
 * dates.
 */
function retentionBoundaryDate(): string {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(utcMidnight - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function dateMinusOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

api.get('/monitors', async (c) => {
  const { user, repo } = await context(c);
  return c.json(await repo.list(user.id));
});

api.post(
  '/monitors',
  zValidator('json', monitorInput),
  async (c) => {
    const { user, repo } = await context(c);
    const input = c.req.valid('json');

    if (
      input.interval_minutes === 1 &&
      c.env.ALLOW_ONE_MINUTE_INTERVAL !== 'true'
    ) {
      throw new AppError(
        400,
        'ONE_MINUTE_INTERVAL_DISABLED',
        'One-minute monitoring is available only in local testing mode.',
      );
    }

    return c.json(
      await repo.create(user.id, input),
      201,
    );
  },
);

api.get('/monitors/:id', async (c) => {
  const { user, repo } = await context(c);

  return c.json(
    await repo.getOwned(c.req.param('id'), user.id),
  );
});

api.patch(
  '/monitors/:id',
  zValidator('json', monitorPatch),
  async (c) => {
    const { user, repo } = await context(c);

    return c.json(
      await repo.update(
        c.req.param('id'),
        user.id,
        c.req.valid('json'),
      ),
    );
  },
);

api.delete('/monitors/:id', async (c) => {
  const { user, repo } = await context(c);

  await repo.remove(c.req.param('id'), user.id);

  return c.body(null, 204);
});

api.get('/monitors/:id/checks', async (c) => {
  const { user, repo } = await context(c);

  const to =
    c.req.query('to') ??
    new Date().toISOString().slice(0, 10);

  const from =
    c.req.query('from') ??
    new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);

  return c.json(
    await repo.checks(
      c.req.param('id'),
      user.id,
      from,
      to,
    ),
  );
});

api.get('/monitors/:id/incidents', async (c) => {
  const { user, repo } = await context(c);

  // Unlike the statistics endpoints, this listing intentionally
  // returns every incident ever recorded for the monitor, not just
  // ones inside a reporting window.
  return c.json(
    await repo.incidents(c.req.param('id'), user.id),
  );
});

/**
 * Builds statistics for a monitor over [query.from, query.to] by
 * combining two data sources:
 *
 *  - daily_monitor_statistics: permanent daily summaries, used for any
 *    requested date older than the 30-day raw retention boundary.
 *  - check_results / incidents: detailed recent records, used for any
 *    requested date on or after that boundary.
 *
 * combineStatistics() merges both without double-counting, even when
 * dailyStats is empty (i.e. the whole requested range is recent) or
 * recentChecks/recentIncidents are empty (the whole range is
 * historical).
 */
async function statistics(c: ApiContext) {
  const { user, repo } = await context(c);
  const id = c.req.param('id');

  if (!id) {
    throw new Error('Monitor id is required by the route.');
  }

  const query = reportQuery.parse({
    from:
      c.req.query('from') ??
      new Date(Date.now() - 30 * 86400000)
        .toISOString()
        .slice(0, 10),
    to:
      c.req.query('to') ??
      new Date().toISOString().slice(0, 10),
  });

  const key = `stats:${user.id}:${id}:${query.from}:${query.to}`;
  const cache = new WorkerCache();

  try {
    const cached = await cache.get<ReturnType<typeof buildStatisticsSeries>>(key);

    if (cached) {
      return {
        monitor: await repo.getOwned(id, user.id),
        stats: cached,
        query,
      };
    }
  } catch {
    // Cache miss/unavailability must never affect correctness — fall
    // through and compute statistics from the database instead.
  }

  const monitor = await repo.getOwned(id, user.id);
  const boundary = retentionBoundaryDate();

  const hasHistoricalPortion = query.from < boundary;
  const hasRecentPortion = query.to >= boundary;
  const recentFrom =
    query.from >= boundary ? query.from : boundary;

  const [dailyStats, recentChecks, recentIncidents] =
    await Promise.all([
      hasHistoricalPortion
        ? repo.dailyStatistics(
            id,
            user.id,
            query.from,
            query.to < boundary
              ? query.to
              : dateMinusOneDay(boundary),
          )
        : Promise.resolve([]),
      hasRecentPortion
        ? repo.checks(id, user.id, recentFrom, query.to)
        : Promise.resolve([]),
      hasRecentPortion
        ? repo.incidentsInRange(
            id,
            user.id,
            recentFrom,
            query.to,
          )
        : Promise.resolve([]),
    ]);

  const summary = combineStatistics({
    dailyStats,
    recentChecks,
    recentIncidents,
    recentRangeStart: recentFrom,
    recentRangeEnd: query.to,
  });

  try {
    await cache.put(
      key,
      buildStatisticsSeries(summary, dailyStats, recentChecks),
      Number(c.env.STATISTICS_CACHE_TTL_SECONDS || 180),
    );
  } catch {
    // Same as above: caching is an optimization only.
  }

  return {
    monitor,
    stats: buildStatisticsSeries(summary, dailyStats, recentChecks),
    query,
  };
}

api.get('/monitors/:id/statistics', async (c) => {
  const result = await statistics(c);

  return c.json(result.stats);
});

api.get('/monitors/:id/report', async (c) => {
  const result = await statistics(c);

  const pdf = await makePdfReport(
    result.monitor,
    result.query.from,
    result.query.to,
    result.stats,
  );

  // pdf-lib returns Uint8Array<ArrayBufferLike>; make an ArrayBuffer-backed
  // copy for the DOM BodyInit typing shared by Worker and frontend builds.
  const body = Uint8Array.from(pdf).buffer as ArrayBuffer;

  return new Response(body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${result.monitor.id}-report.pdf"`,
    },
  });
});

/**
 * Manual, on-demand check for an authenticated owner of the monitor.
 *
 * This is a normal authenticated user-facing operation: it is gated by
 * the same authentication and rate limiting as every other route via
 * context(), and by ownership via getOwned(). There is no
 * environment/origin based restriction — a deployed dashboard is
 * expected to be able to call this in production.
 */
api.post('/monitors/:id/check', async (c) => {
  if (c.env.ALLOW_MANUAL_CHECKS !== 'true') {
    throw new AppError(
      403,
      'MANUAL_CHECKS_DISABLED',
      'Manual checks are disabled outside local development.',
    );
  }

  const { user, db, repo } = await context(c);

  const monitor = await repo.getOwned(
    c.req.param('id'),
    user.id,
  );

  const result = await checkMonitor(monitor);

  // Manual checks use a distinct execution-key namespace
  // ("...:manual:<uuid>") so they can never collide with a scheduled
  // check's slot-derived execution key.
  const executionKey = `${monitor.id}:manual:${crypto.randomUUID()}`;

  await repo.recordCheck({
    id: crypto.randomUUID(),
    monitor_id: monitor.id,
    checked_at: result.checkedAt,
    success: result.success,
    http_status: result.httpStatus,
    response_ms: result.responseMs,
    failure_type: result.failureType,
    error_message: result.errorMessage,
    execution_key: executionKey,
    created_at: new Date().toISOString(),
  });

  const event = await applyCheckTransition(db, {
    monitorId: monitor.id,
    executionKey,
  });

  if (event) {
    await notify(c.env, monitor, event);
  }

  return c.json(result);
});