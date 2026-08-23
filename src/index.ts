import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { api } from './routes/api';
import {
  runRetention,
  runScheduler,
} from './services/scheduler-service';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin, c) =>
      origin === c.env.APP_ORIGIN
        ? origin
        : c.env.APP_ORIGIN,
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  }),
);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/api/v1', api);

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ) {
    switch (event.cron) {
      case '*/5 * * * *':
        ctx.waitUntil(runScheduler(env));
        break;

      // Wrangler's local /cdn-cgi/local/scheduled test endpoint does not
      // populate ScheduledEvent.cron. Treat that one known local-test shape
      // as the monitoring trigger so developers can exercise the real
      // scheduler without weakening production cron differentiation.
      case '':
        console.info(
          'Local scheduled test received; running monitor scheduler.',
        );
        ctx.waitUntil(runScheduler(env));
        break;

      case '15 1 * * *':
        ctx.waitUntil(runRetention(env));
        break;

      default:
        console.warn(`Unknown cron trigger received: ${event.cron}`);
    }
  },
};
