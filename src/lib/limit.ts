import { AppError } from './errors';

const windowMs = 60_000;

const hits = new Map<
  string,
  {
    count: number;
    reset: number;
  }
>();

let nextCleanupAt = 0;

/**
 * Best-effort, per-isolate rate limit for authenticated API calls. It is not
 * a distributed Cloudflare-wide traffic control and deliberately remains
 * separate from the database-enforced monitor quota and check concurrency.
 */

export function enforceRateLimit(
  key: string,
  limit = 60
): void {
  const now = Date.now();

  // Isolates can handle many short-lived user keys over their lifetime.
  // Periodically discard expired counters so the map stays bounded by
  // currently active users instead of retaining stale entries forever.
  if (now >= nextCleanupAt) {
    for (const [entryKey, entry] of hits) {
      if (entry.reset <= now) hits.delete(entryKey);
    }
    nextCleanupAt = now + windowMs;
  }

  const entry = hits.get(key);

  if (!entry || entry.reset <= now) {
    hits.set(key, {
      count: 1,
      reset: now + windowMs,
    });

    return;
  }

  if (entry.count >= limit) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      'Too many requests. Please try again shortly.'
    );
  }

  entry.count++;
}
