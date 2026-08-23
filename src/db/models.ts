// One minute is accepted only when the Worker explicitly enables the local
// testing flag. The normal product minimum remains five minutes.
export const ALLOWED_INTERVALS = [1, 5, 10, 15, 30] as const;

export type IntervalMinutes = (typeof ALLOWED_INTERVALS)[number];

export type FailureType =
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'CONNECTION_ERROR'
  | 'UNEXPECTED_ERROR';

export type MonitorState =
  | 'HEALTHY'
  | 'SUSPECTED_FAILURE'
  | 'DOWN';

export interface Monitor {
  id: string;
  user_id: string;
  name: string;
  url: string;
  enabled: boolean;
  interval_minutes: IntervalMinutes;
  next_check_at: string;
  state: MonitorState;
  consecutive_failures: number;
  last_failure_at: string | null;
  notification_email_enabled: boolean;
  notification_webhook_enabled: boolean;
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckResult {
  id: string;
  monitor_id: string;
  checked_at: string;
  success: boolean;
  http_status: number | null;
  response_ms: number | null;
  failure_type: FailureType | null;
  error_message: string | null;
  execution_key: string;
  created_at: string;
  /**
   * Set by apply_check_transition() once this check has driven its
   * one-time state transition. This is the real idempotency marker —
   * error_message is never repurposed for this and always holds only
   * genuine error text (or null).
   */
  transition_processed_at?: string | null;
}

export interface Statistics {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  uptimePercentage: number;
  averageResponseMs: number | null;
  minimumResponseMs: number | null;
  maximumResponseMs: number | null;
  incidentCount: number;
  totalDowntimeSeconds: number;
}

/**
 * One permanent daily summary row, as produced by
 * aggregate_and_delete_expired_checks(). Rows are never deleted, only
 * inserted/updated once per (monitor_id, stat_date) as raw checks for
 * that date cross the 30-day retention boundary.
 */
export interface DailyMonitorStatistic {
  monitor_id: string;
  stat_date: string;
  total_checks: number;
  successful_checks: number;
  failed_checks: number;
  uptime_percentage: number;
  avg_response_ms: number | null;
  min_response_ms: number | null;
  max_response_ms: number | null;
  incident_count: number;
  total_downtime_seconds: number;
}

export interface StatisticsPoint {
  date: string;
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  uptimePercentage: number;
  averageResponseMs: number | null;
  incidentCount: number;
  downtimeSeconds: number;
}

export interface StatisticsSeries {
  summary: Statistics;
  points: StatisticsPoint[];
  failureTypes: Array<{
    type: FailureType;
    count: number;
  }>;
  httpStatuses: Array<{
    status: number | null;
    count: number;
  }>;
  incidents: Array<{
    id: string;
    started_at: string;
    confirmed_at: string;
    resolved_at: string | null;
    status: string;
    failure_type: FailureType | null;
    duration_seconds: number | null;
  }>;
}
