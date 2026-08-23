import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CheckResult,
  DailyMonitorStatistic,
  IntervalMinutes,
  Monitor,
} from '../db/models';
import { AppError } from '../lib/errors';
import { monitorInput } from '../lib/validation';

export interface ClaimedMonitor extends Monitor {
  scheduled_for: string;
  execution_key: string;
}

export interface MonitorInput {
  name: string;
  url: string;
  enabled?: boolean;
  interval_minutes: IntervalMinutes;
  notification_email_enabled?: boolean;
  notification_webhook_enabled?: boolean;
  webhook_url?: string | null;
}

export class MonitorRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(userId: string): Promise<Monitor[]> {
    const { data, error } = await this.db
      .from('monitors')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as Monitor[];
  }

  async getOwned(id: string, userId: string): Promise<Monitor> {
    const { data, error } = await this.db
      .from('monitors')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new AppError(
        404,
        'NOT_FOUND',
        'Monitor not found.',
      );
    }

    return data as Monitor;
  }

  /**
   * Creates a monitor for the given user.
   *
   * The 25-monitor-per-user quota is enforced atomically inside the
   * create_monitor() database function (via a per-user advisory
   * transaction lock, then count, then insert, all in one round trip),
   * not by a count-then-insert sequence here. Two concurrent requests
   * at the boundary can no longer both succeed and push the user to 26
   * monitors.
   */
  async create(
    userId: string,
    input: MonitorInput,
  ): Promise<Monitor> {
    const { data, error } = await this.db.rpc('create_monitor', {
      p_user_id: userId,
      p_name: input.name,
      p_url: input.url,
      p_enabled: input.enabled ?? true,
      p_interval_minutes: input.interval_minutes,
      p_notification_email_enabled:
        input.notification_email_enabled ?? false,
      p_notification_webhook_enabled:
        input.notification_webhook_enabled ?? false,
      p_webhook_url: input.webhook_url ?? null,
    });

    if (error) {
      if (error.message?.includes('MONITOR_QUOTA_REACHED')) {
        throw new AppError(
          429,
          'MONITOR_QUOTA_REACHED',
          'The maximum of 25 monitors has been reached.',
        );
      }
      throw error;
    }

    return data as Monitor;
  }

  async update(
    id: string,
    userId: string,
    input: Record<string, unknown>,
  ): Promise<Monitor> {
    const existing = await this.getOwned(id, userId);

    // A PATCH is partial, but webhook validity is a property of the complete
    // monitor configuration. Validate the merged result before persisting it.
    // This permits an existing HTTPS webhook to be retained when webhooks are
    // enabled in a separate PATCH request while rejecting an invalid end state.
    const merged = monitorInput.parse({
      name: existing.name,
      url: existing.url,
      enabled: existing.enabled,
      interval_minutes: existing.interval_minutes,
      notification_email_enabled:
        existing.notification_email_enabled,
      notification_webhook_enabled:
        existing.notification_webhook_enabled,
      webhook_url: existing.webhook_url,
      ...input,
    });

    const { data, error } = await this.db
      .from('monitors')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data as Monitor;
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.getOwned(id, userId);

    const { error } = await this.db
      .from('monitors')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
  }

  async claimDue(limit: number): Promise<ClaimedMonitor[]> {
    const { data, error } = await this.db.rpc(
      'claim_due_monitors',
      {
        p_limit: limit,
      },
    );

    if (error) throw error;

    return (data ?? []) as ClaimedMonitor[];
  }

  async recordCheck(result: CheckResult): Promise<void> {
    const { error } = await this.db
      .from('check_results')
      .upsert(result, {
        onConflict: 'monitor_id,execution_key',
        ignoreDuplicates: true,
      });

    if (error) throw error;
  }

  async checks(
    id: string,
    userId: string,
    from: string,
    to: string,
  ) {
    await this.getOwned(id, userId);

    const { data, error } = await this.db
      .from('check_results')
      .select('*')
      .eq('monitor_id', id)
      .gte('checked_at', from)
      .lte('checked_at', `${to}T23:59:59.999Z`)
      .order('checked_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  /**
   * All incidents ever recorded for the monitor, unfiltered by date.
   * Used by the plain incident-listing endpoint, which intentionally
   * shows full history. For reporting/statistics purposes, use
   * incidentsInRange() instead so periods outside the request aren't
   * included.
   */
  async incidents(id: string, userId: string) {
    await this.getOwned(id, userId);

    const { data, error } = await this.db
      .from('incidents')
      .select('*')
      .eq('monitor_id', id)
      .order('started_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Incidents that overlap [from, to] at all (started before the end
   * of `to` and, if resolved, resolved after the start of `from`).
   * Used for statistics so an incident's contribution can be clipped to
   * the requested window instead of counting its entire lifetime.
   */
  async incidentsInRange(
    id: string,
    userId: string,
    from: string,
    to: string,
  ) {
    await this.getOwned(id, userId);

    const fromStart = `${from}T00:00:00.000Z`;
    const toEnd = `${to}T23:59:59.999Z`;

    const { data, error } = await this.db
      .from('incidents')
      .select('*')
      .eq('monitor_id', id)
      .lt('started_at', toEnd)
      .or(`resolved_at.is.null,resolved_at.gt.${fromStart}`)
      .order('started_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Permanent daily summaries for dates in [from, to]. This is the
   * only place historical data older than the 30-day raw retention
   * window can still be read from.
   */
  async dailyStatistics(
    id: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<DailyMonitorStatistic[]> {
    await this.getOwned(id, userId);

    const { data, error } = await this.db
      .from('daily_monitor_statistics')
      .select('*')
      .eq('monitor_id', id)
      .gte('stat_date', from)
      .lte('stat_date', to);

    if (error) throw error;
    return (data ?? []) as DailyMonitorStatistic[];
  }
}
