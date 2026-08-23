import { describe, expect, it } from 'vitest';
import { enforceRateLimit } from '../src/lib/limit';

describe('rate limit', () => {
  it('returns an honest 429 error at the configured boundary', () => {
    const key = `test-${crypto.randomUUID()}`;
    enforceRateLimit(key, 1);

    let error: unknown;
    try {
      enforceRateLimit(key, 1);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });
});
