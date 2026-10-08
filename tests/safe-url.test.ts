import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl } from '../src/lib/safe-url';

describe('public HTTP URL validation', () => {
  it('allows public HTTP and HTTPS targets', () => {
    expect(isPublicHttpUrl('http://example.com/health')).toBe(true);
    expect(isPublicHttpUrl('https://status.example.com')).toBe(true);
  });

  it.each([
    'http://localhost/admin',
    'http://api.local/health',
    'http://127.0.0.1/',
    'http://10.0.0.4/',
    'http://172.20.0.10/',
    'http://192.168.1.20/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://user:password@example.com/',
    'file:///etc/passwd',
  ])('rejects unsafe target %s', (value) => {
    expect(isPublicHttpUrl(value)).toBe(false);
  });

  it('requires HTTPS for webhook destinations', () => {
    expect(isPublicHttpUrl('http://hooks.example.com', true)).toBe(false);
    expect(isPublicHttpUrl('https://hooks.example.com', true)).toBe(true);
  });
});
