import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// The catalog's routes are read-only (BLUEPRINT §5.4): none accepts a write, so there is nothing for an
// unauthenticated PUT or DELETE to change. Phase 5's writes are routes of their own (/cal, /sync, /reports), each
// with its spec.
const BASE = 'https://sub.simplely.ca/api/v1';

describe('write methods', () => {
  const routes = [
    '/health',
    '/catalog',
    '/features',
    '/categories',
    '/fx',
    '/icon',
    '/providers',
    '/providers/netflix',
    '/plans/netflix.standard',
    '/bundles',
  ];
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
