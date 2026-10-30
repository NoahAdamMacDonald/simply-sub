import {
  calendarSetBodySchema,
  calendarSetUpdateBodySchema,
  type CalendarFeeds,
  type CalendarSetBody,
  type CalendarSetUpdateBody,
} from '@simply-sub/core';

// The live calendar's calls to the API (BLUEPRINT §5.2, M10.2): POST /cal makes a feed set, PUT /cal/:id replaces it and
// DELETE /cal/:id revokes it, the last two with its manage key. An answer is read with core's schemas, so a key or a
// token the app keeps is one the server made.

/** Why a call didn't do what it asked. */
export type LiveCalendarProblem =
  /** No network, or no answer. */
  | 'offline'
  /** The set is gone: revoked from another device, or expired after 180 days unwritten. */
  | 'gone'
  /** Too many changes this minute. */
  | 'busy'
  /** The server has stored all it takes today, or has no room. */
  | 'full'
  /** The server refused what was sent: more payments than a live calendar takes, say. */
  | 'refused'
  | 'failed';

export class LiveCalendarError extends Error {
  constructor(readonly problem: LiveCalendarProblem) {
    super(`The live calendar's request failed: ${problem}`);
    this.name = 'LiveCalendarError';
  }
}

const base = '/api/v1/cal';

/** Makes a feed set of `feeds`: its id, its manage key, and each feed's links, in the order sent. */
export async function createFeedSet(feeds: CalendarFeeds): Promise<CalendarSetBody['data']> {
  const answer = await send('POST', base, { body: feeds });
  return calendarSetBodySchema.parse(await answer.json()).data;
}

/** Replaces set `id`'s feeds with `feeds`: each feed's links, in the order sent. */
export async function replaceFeedSet(
  id: string,
  manageKey: string,
  feeds: CalendarFeeds,
): Promise<CalendarSetUpdateBody['data']> {
  const answer = await send('PUT', `${base}/${id}`, { body: feeds, manageKey });
  return calendarSetUpdateBodySchema.parse(await answer.json()).data;
}

/** Revokes set `id`. One that's gone already is as good as revoked. */
export async function revokeFeedSet(id: string, manageKey: string): Promise<void> {
  try {
    await send('DELETE', `${base}/${id}`, { manageKey });
  } catch (error) {
    if (!(error instanceof LiveCalendarError && error.problem === 'gone')) throw error;
  }
}

/** The answer to a request, or a LiveCalendarError saying why there's no good one. */
async function send(
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  { body, manageKey }: { body?: CalendarFeeds; manageKey?: string },
): Promise<Response> {
  let answer: Response;
  try {
    answer = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(manageKey !== undefined && { Authorization: `Bearer ${manageKey}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new LiveCalendarError('offline');
  }
  if (answer.ok) return answer;
  throw new LiveCalendarError(
    answer.status === 404 || answer.status === 403
      ? 'gone'
      : answer.status === 429
        ? 'busy'
        : answer.status === 503
          ? 'full'
          : answer.status === 400 || answer.status === 413
            ? 'refused'
            : 'failed',
  );
}
