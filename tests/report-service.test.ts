import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Monitor, StatisticsSeries } from '../src/db/models';
import { makePdfReport } from '../src/services/report-service';

const monitor: Monitor = {
  id: 'monitor-id', user_id: 'user-id', name: 'Example API',
  url: 'https://example.test/health', enabled: true,
  interval_minutes: 5, next_check_at: '2026-08-20T00:00:00.000Z',
  state: 'HEALTHY', consecutive_failures: 0, last_failure_at: null,
  notification_email_enabled: false, notification_webhook_enabled: false,
  webhook_url: null, created_at: '2026-08-20T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:00.000Z',
};

const series: StatisticsSeries = {
  summary: {
    totalChecks: 2, successfulChecks: 1, failedChecks: 1,
    uptimePercentage: 50, averageResponseMs: 150, minimumResponseMs: 100,
    maximumResponseMs: 200, incidentCount: 1, totalDowntimeSeconds: 60,
  },
  points: [{
    date: '2026-08-20', totalChecks: 2, successfulChecks: 1,
    failedChecks: 1, uptimePercentage: 50, averageResponseMs: 150,
    incidentCount: 1, downtimeSeconds: 60,
  }],
  failureTypes: [{ type: 'HTTP_ERROR', count: 1 }],
  httpStatuses: [{ status: 200, count: 1 }, { status: 503, count: 1 }],
  incidents: [],
};

describe('PDF reporting', () => {
  it('creates a readable PDF from the chart-ready statistics series', async () => {
    const bytes = await makePdfReport(monitor, '2026-08-20', '2026-08-20', series);
    const pdf = await PDFDocument.load(bytes);

    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(pdf.getPageCount()).toBe(1);
  });
});
