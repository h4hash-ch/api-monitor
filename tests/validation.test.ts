import { describe, expect, it } from 'vitest';
import { monitorInput, monitorPatch } from '../src/lib/validation';

describe('monitor validation', () => {
  const input = {
    name: 'API',
    url: 'http://example.test/health',
    interval_minutes: 5,
  };

  it('requires HTTPS for notification webhooks while allowing HTTP monitor targets', () => {
    expect(() => monitorInput.parse(input)).not.toThrow();
    expect(() => monitorInput.parse({
      ...input,
      notification_webhook_enabled: true,
      webhook_url: 'http://hooks.example.test/notify',
    })).toThrow(/HTTPS/);
  });

  it('accepts a partial patch for repository-level merged validation', () => {
    expect(monitorPatch.parse({ notification_webhook_enabled: true }))
      .toEqual({ notification_webhook_enabled: true });
  });
});
