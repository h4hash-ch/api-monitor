import type { FailureType, Monitor } from '../db/models';

export interface EngineResult {
  success: boolean;
  httpStatus: number | null;
  responseMs: number | null;
  failureType: FailureType | null;
  errorMessage: string | null;
  checkedAt: string;
}

export async function checkMonitor(
  monitor: Monitor,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<EngineResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const started = Date.now();

  try {
    const response = await fetcher(monitor.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': '10x-api-monitor/0.1',
      },
    });

    const responseMs = Date.now() - started;

    if (response.ok) {
      return {
        success: true,
        httpStatus: response.status,
        responseMs,
        failureType: null,
        errorMessage: null,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      success: false,
      httpStatus: response.status,
      responseMs,
      failureType: 'HTTP_ERROR',
      errorMessage: `Received HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unexpected network failure';

    return {
      success: false,
      httpStatus: null,
      responseMs: Date.now() - started,
      // The timeout controller is our reliable signal. Runtime-specific error
      // message text is not a classification API; non-timeout TypeErrors are
      // the standard fetch surface for connection failures in Workers.
      failureType: timedOut
        ? 'TIMEOUT'
        : error instanceof TypeError
          ? 'CONNECTION_ERROR'
          : 'UNEXPECTED_ERROR',
      errorMessage: message,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
