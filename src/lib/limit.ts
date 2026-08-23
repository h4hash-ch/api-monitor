import { AppError } from './errors';

const windowMs = 60_000;

const hits = new Map<
  string,
  {
    count: number;
    reset: number;
  }
>();

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
