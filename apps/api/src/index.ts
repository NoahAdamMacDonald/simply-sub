import { Hono } from 'hono';
import { catalog } from './routes/catalog';
import { categories } from './routes/categories';
import { features } from './routes/features';
import { fx } from './routes/fx';
import { health } from './routes/health';
import { providers } from './routes/providers';

// Every API route lives under /api/v1 (BLUEPRINT §5.2). Other paths never reach the Worker:
// wrangler.jsonc serves them from the static assets.
const app = new Hono<{ Bindings: Env }>().basePath('/api/v1');
app.route('/catalog', catalog);
app.route('/categories', categories);
app.route('/features', features);
app.route('/fx', fx);
app.route('/health', health);
app.route('/providers', providers);

export default app;
