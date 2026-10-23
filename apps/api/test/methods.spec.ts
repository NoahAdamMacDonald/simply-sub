import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// The API is read-only (BLUEPRINT §5.4): no route accepts a write, so there is nothing for an
// unauthenticated PUT or DELETE to change. Phase 5's POST /reports will be the first exception.
const BASE = 'https://simplely.ca/api/sub/v1';

describe('write methods', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is refused on every route', async (method) => {
    const response = await exports.default.fetch(`${BASE}/health`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'hacked' }),
    });

    expect([404, 405]).toContain(response.status);
  });
});
