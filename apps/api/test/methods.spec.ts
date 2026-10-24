import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// The API is read-only (BLUEPRINT §5.4): no route accepts a write, so there is nothing for an
// unauthenticated PUT or DELETE to change. Phase 5's POST /reports will be the first exception.
const BASE = 'https://sub.simplely.ca/api/v1';

describe('write methods', () => {
  const routes = ['/health', '/catalog', '/features', '/categories', '/fx', '/providers'];
  const methods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  it.each(methods.flatMap((method) => routes.map((route) => [method, route])))(
    '%s is refused on %s',
    async (method, route) => {
      const response = await exports.default.fetch(`${BASE}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'hacked' }),
      });

      expect([404, 405]).toContain(response.status);
    },
  );
});
