import { describe, expect, it } from 'vitest';
import { checkMonitor } from '../src/services/monitoring-engine';

const monitor: any = {
  url: 'https://example.test',
};

describe('monitoring engine', () => {
  it('classifies non-2xx response as HTTP error', async () => {
    const result = await checkMonitor(
      monitor,
      async () => new Response('', { status: 503 }),
    );

    expect(result).toMatchObject({
      success: false,
      httpStatus: 503,
      failureType: 'HTTP_ERROR',
    });
  });

  it('classifies aborts as timeouts', async () => {
    const result = await checkMonitor(
      monitor,
      async (_url, init) => {
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () =>
              reject(
                new DOMException('aborted', 'AbortError'),
              ),
          );
        });

        return new Response();
      },
      1,
    );

    expect(result.failureType).toBe('TIMEOUT');
  });

  it('records any successful 2xx response as healthy', async () => {
    const result = await checkMonitor(
      monitor,
      async () => new Response(null, { status: 204 }),
    );

    expect(result).toMatchObject({
      success: true,
      httpStatus: 204,
      failureType: null,
      errorMessage: null,
    });
  });

  it('classifies fetch connection failures without matching error text', async () => {
    const result = await checkMonitor(
      monitor,
      async () => {
        throw new TypeError('socket closed');
      },
    );

    expect(result.failureType).toBe('CONNECTION_ERROR');
  });

  it('keeps unexpected runtime errors distinct from connection failures', async () => {
    const result = await checkMonitor(
      monitor,
      async () => {
        throw new Error('configuration problem');
      },
    );

    expect(result.failureType).toBe('UNEXPECTED_ERROR');
  });
});
