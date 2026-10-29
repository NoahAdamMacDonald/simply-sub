import { Hono } from 'hono';
import { cleanUp } from './clean-up';
import { utcDay } from './http';
import { apiHeaders, edgeCache, noRoute, rateLimit, unexpectedError } from './middleware';
import { bundles } from './routes/bundles';
import { cal } from './routes/cal';
import { catalog } from './routes/catalog';
import { categories } from './routes/categories';
import { features } from './routes/features';
import { fx } from './routes/fx';
import { health } from './routes/health';
import { icon } from './routes/icon';
import { plans } from './routes/plans';
import { provider } from './routes/provider';
import { providers } from './routes/providers';
import { writeLimit } from './writes';

// Every API route lives under /api/v1 (BLUEPRINT §5.2). Other paths never reach the Worker: wrangler.jsonc serves
// them from the static assets, and only /api/* runs it. Every /api/* request gets the API's headers and the rate limit
// (middleware.ts), a write the write limit too (writes.ts, M10.1), and the v1 routes that read D1 or KV the edge cache.
// The cron trigger runs the nightly clean-up of the user database (clean-up.ts).
const v1 = new Hono<{ Bindings: Env }>()
  .use('*', edgeCache)
  .route('/bundles', bundles)
  .route('/cal', cal)
  .route('/catalog', catalog)
  .route('/categories', categories)
  .route('/features', features)
  .route('/fx', fx)
  .route('/health', health)
  .route('/icon', icon)
  .route('/plans', plans)
  .route('/providers', providers)
  .route('/providers', provider);

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', apiHeaders, rateLimit, writeLimit);
app.route('/api/v1', v1);
app.notFound(noRoute);
app.onError(unexpectedError);

export default {
  fetch: app.fetch,
  scheduled(controller, env, context) {
    context.waitUntil(cleanUp(env.USER_DB, utcDay(new Date(controller.scheduledTime))));
  },
} satisfies ExportedHandler<Env>;
