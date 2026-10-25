import { readIconQuery } from '@simply-sub/core';
import { Hono } from 'hono';
import { badQuery, jsonType } from '../http';
import { iconSeconds, keptIcon, noIconSeconds } from '../icons';

/**
 * GET /icon (docs/api-output-examples.json): the icon of a website a user typed for a custom subscription, from
 * Google's or DuckDuckGo's icon service (icons.ts). Catalog providers' icons are static files instead. Without a
 * usable icon (a square PNG of at least 32 pixels), 404, and the app shows the subscription's first letter. Both
 * answers may be cached: an icon doesn't change under its URL for 30 days, "no icon" holds for a day.
 */
export const icon = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const read = readIconQuery(c.req.queries(), {
    toAscii: (host) => URL.parse(`https://${host}`)?.hostname,
  });
  if ('problems' in read) {
    return badQuery(c, read.problems);
  }
  const { domain } = read.query;
  const found = await keptIcon(c.env, domain);
  if (!found) {
    return c.json({ error: { code: 'not_found', message: `No icon found for ${domain}.` } }, 404, {
      'Content-Type': jsonType,
      'Cache-Control': `public, max-age=${noIconSeconds}`,
    });
  }
  return c.body(found.png, 200, {
    'Content-Type': 'image/png',
    'Cache-Control': `public, max-age=${iconSeconds}, immutable`,
    'X-Icon-Source': found.source,
  });
});
