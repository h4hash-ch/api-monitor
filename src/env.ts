export interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;

  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;

  APP_ORIGIN: string;

  MAX_SCHEDULE_BATCH: string;
  MAX_SCHEDULE_BATCHES: string;
  CHECK_CONCURRENCY: string;
  STATISTICS_CACHE_TTL_SECONDS: string;
  /** Development-only opt-in for the one-minute scheduler demo. */
  ALLOW_ONE_MINUTE_INTERVAL?: string;
  /** Development-only opt-in for the owner-triggered manual check route. */
  ALLOW_MANUAL_CHECKS?: string;
}
