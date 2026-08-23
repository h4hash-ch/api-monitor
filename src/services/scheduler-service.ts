import type { Env } from '../env';
import { serviceClient } from '../lib/auth';
import { boundedMap } from '../lib/concurrency';
import {
  MonitorRepository,
} from '../repositories/monitor-repository';
import { checkMonitor } from './monitoring-engine';
import {
  applyCheckTransition,
} from './incident-service';
import { notify } from './notification-service';

export async function runScheduler(env: Env) {
  const db = serviceClient(env);
  const repo = new MonitorRepository(db);

  const batchSize = Number(env.MAX_SCHEDULE_BATCH || 25);
  const maxBatches = Number(env.MAX_SCHEDULE_BATCHES || 2);
  const concurrency = Number(env.CHECK_CONCURRENCY || 5);

  let totalProcessed = 0;

  console.info('Scheduler started', {
    batchSize,
    maxBatches,
    concurrency,
  });

  for (let batchNumber = 0; batchNumber < maxBatches; batchNumber++) {
    const due = await repo.claimDue(batchSize);

    if (due.length === 0) {
      break;
    }

    await boundedMap(
      due,
      concurrency,
      async (monitor) => {
        const result = await checkMonitor(monitor);

        console.info('Monitor check completed', {
          monitorId: monitor.id,
          success: result.success,
          failureType: result.failureType,
          responseMs: result.responseMs,
        });

        await repo.recordCheck({
          id: crypto.randomUUID(),
          monitor_id: monitor.id,
          checked_at: result.checkedAt,
          success: result.success,
          http_status: result.httpStatus,
          response_ms: result.responseMs,
          failure_type: result.failureType,
          error_message: result.errorMessage,
          execution_key: monitor.execution_key,
          created_at: new Date().toISOString(),
        });

        const event = await applyCheckTransition(
          db,
          {
            monitorId: monitor.id,
            executionKey: monitor.execution_key,
          },
        );

        if (event) {
          await notify(env, monitor, event);
        }
      },
    );

    totalProcessed += due.length;

    // If this batch wasn't full, there is no reason to issue
    // another claim immediately.
    if (due.length < batchSize) {
      break;
    }
  }

  console.info('Scheduler finished', { totalProcessed });
  return totalProcessed;
}

export async function runRetention(env: Env) {
  console.info('Retention started');
  const { error } = await serviceClient(env).rpc(
    'aggregate_and_delete_expired_checks',
  );

  if (error) throw error;
  console.info('Retention finished');
}
