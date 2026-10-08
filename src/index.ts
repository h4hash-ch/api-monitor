import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { api } from './routes/api';
import {
  runRetention,
  runScheduler,
} from './services/scheduler-service';

const app = new Hono<{ Bindings: Env }>();

// Static frontend files receive matching headers from frontend/public/_headers.
// API/health/PDF responses are produced by this Worker, so set their headers
// here rather than relying on the static asset configuration.
app.use('*', async (c, next) => {
  await next();
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Strict-Transport-Security', 'max-age=31536000');
});

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
