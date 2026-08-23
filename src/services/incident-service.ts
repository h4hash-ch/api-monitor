import type { SupabaseClient } from '@supabase/supabase-js';

export type IncidentEvent =
  | {
      type: 'OPENED' | 'RECOVERED';
      incidentId: string;
    }
  | null;

interface TransitionResult {
  type: 'OPENED' | 'RECOVERED';
  incidentId: string;
}

/**
 * Drives the incident/state-machine transition for one already-recorded
 * check (identified by monitorId + executionKey).
 *
 * Deliberately takes only the identifying pair, not the check's own
 * success/failure/checkedAt values: apply_check_transition() re-reads
 * those directly from the locked check_results row in the database
 * rather than trusting whatever the caller happens to pass in. This
 * closes off any possibility of a caller supplying stale or mismatched
 * values for a given execution.
 *
 * Idempotency: the underlying database function is itself the
 * idempotency boundary via check_results.transition_processed_at.
 * Calling this twice for the same (monitorId, executionKey) is always
 * safe and the second call returns null.
 */
export async function applyCheckTransition(
  db: SupabaseClient,
  input: {
    monitorId: string;
    executionKey: string;
  },
): Promise<IncidentEvent> {
  const { data, error } = await db.rpc(
    'apply_check_transition',
    {
      p_monitor_id: input.monitorId,
      p_execution_key: input.executionKey,
    },
  );

  if (error) throw error;

  if (!data) {
    return null;
  }

  return data as TransitionResult;
}