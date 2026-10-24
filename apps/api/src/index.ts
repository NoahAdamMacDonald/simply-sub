import { Hono } from 'hono';
import { health } from './routes/health';

// Every API route lives under /api/v1 (BLUEPRINT §5.2). Other paths never reach the Worker:
// wrangler.jsonc serves them from the static assets.
const app = new Hono<{ Bindings: Env }>().basePath('/api/v1');
app.route('/health', health);

export default app;
