import type { Env } from '../env';
import type { Monitor } from '../db/models';
import type { IncidentEvent } from './incident-service';
import { serviceClient } from '../lib/auth';

const NOTIFICATION_TIMEOUT_MS = 8_000;

/**
 * Best-effort delivery. Notifications are not retried; a failed
 * channel is logged and does not affect the other enabled channel or
 * the monitoring operation itself.
 *
 * Both bounded execution time (via AbortController) and inspection of
 * the HTTP response status are handled here: a webhook or email
 * provider that returns e.g. HTTP 500 is treated as a failed delivery,
 * not a silent success.
 */
async function deliver(
  url: string,
  init: RequestInit,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    NOTIFICATION_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Notification endpoint responded with HTTP ${response.status}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function notify(
  env: Env,
  monitor: Monitor,
  event: IncidentEvent,
) {
  if (!event) return;

  const payload = {
    event_type:
      event.type === 'OPENED'
        ? 'incident.opened'
        : 'incident.recovered',
    monitor_id: monitor.id,
    monitor_name: monitor.name,
    incident_id: event.incidentId,
    timestamp: new Date().toISOString(),
  };

  const jobs: Array<{
    channel: 'webhook' | 'email';
    promise: Promise<void>;
  }> = [];

  if (
    monitor.notification_webhook_enabled &&
    monitor.webhook_url
  ) {
    jobs.push({
      channel: 'webhook',
      promise: deliver(monitor.webhook_url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    });
  }

  if (
    monitor.notification_email_enabled &&
    env.EMAIL_API_URL &&
    env.EMAIL_API_KEY
  ) {
    const emailApiUrl = env.EMAIL_API_URL;
    const emailApiKey = env.EMAIL_API_KEY;

    jobs.push({
      channel: 'email',
      promise: (async () => {
        // The monitor model only records whether email notifications
        // are enabled, not a recipient address. The recipient is
        // resolved at send time from the monitor owner's Supabase Auth
        // account, using the privileged service client (never exposed
        // to the frontend).
        const db = serviceClient(env);
        const { data, error } =
          await db.auth.admin.getUserById(monitor.user_id);

        if (error || !data?.user?.email) {
          throw new Error(
            'Unable to resolve monitor owner email for notification',
          );
        }

        await deliver(emailApiUrl!, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${emailApiKey!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ...payload,
            to: data.user.email,
            subject:
              event.type === 'OPENED'
                ? `[Incident] ${monitor.name} is down`
                : `[Resolved] ${monitor.name} has recovered`,
          }),
        });
      })(),
    });
  }

  const results = await Promise.allSettled(
    jobs.map((job) => job.promise),
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      // Never log tokens, recipient addresses, or webhook URLs here —
      // only enough to diagnose which channel/monitor/event failed.
      console.warn('Notification delivery failed', {
        monitorId: monitor.id,
        channel: jobs[index].channel,
        event: payload.event_type,
      });
    }
  });
}
