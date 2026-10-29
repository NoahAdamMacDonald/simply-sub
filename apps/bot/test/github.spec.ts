import { describe, expect, it } from 'vitest';
import { digestBranch as botBranch } from '../src/digest';
import { botSignature, GitHub, resellerSites } from '../src/github';
import type { Proposal } from '../src/proposal';

// The pull request through GitHub's REST API, against a fake GitHub that records every call: one branch of the bot's
// own, rebuilt from the base branch, one pull request opened or refreshed, never a merge or a push to main.

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function fakeGitHub(
  open: { number: number; html_url: string }[],
  branch: boolean,
  lastMessage = `Catalog digest 2026-10-26\n\n${botSignature} Review before merging.`,
) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/repos/owner/simply-sub/', '') + url.search;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, ...(init?.body && { body: JSON.parse(String(init.body)) }) });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (method === 'GET' && path === `git/ref/heads/${botBranch}`) {
      return branch ? json({ object: { sha: 'old' } }) : json({ message: 'Not Found' }, 404);
    }
    if (method === 'GET' && path === 'git/commits/old') return json({ message: lastMessage });
    if (method === 'POST' && path === 'git/blobs') return json({ sha: `blob${calls.length}` }, 201);
    if (method === 'POST' && path === 'git/trees') return json({ sha: 'tree1' }, 201);
    if (method === 'POST' && path === 'git/commits') return json({ sha: 'commit1' }, 201);
    if (path.startsWith('pulls?')) return json(open);
    if (method === 'POST' && path === 'pulls')
      return json({ html_url: 'https://github.com/owner/simply-sub/pull/7' }, 201);
    return json({});
  }) as typeof fetch;
  return {
    calls,
    github: new GitHub({
      token: 't0ken',
      repository: 'owner/simply-sub',
      base: 'main',
      fetch: fetcher,
    }),
  };
}

const made: Proposal = {
  title: 'Price updates 2026-10-29',
  body: 'The nightly price check…',
  changes: [
    { path: 'data/providers/netflix.yaml', text: 'id: netflix\n' },
    { path: 'data/logos/netflix.png', base64: 'iVBORw0KGgo=' },
  ],
};
const state = { commit: 'base1', tree: 'basetree', logos: {}, resellers: [] };

describe('GitHub', () => {
  it('commits on its own branch from the base branch and opens a pull request', async () => {
    const { calls, github } = fakeGitHub([], false);
    expect(await github.propose(state, made, botBranch)).toBe(
      'https://github.com/owner/simply-sub/pull/7',
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET git/ref/heads/${botBranch}`,
      `GET pulls?state=open&head=owner:${botBranch}`,
      'POST git/blobs',
      'POST git/trees',
      'POST git/commits',
      'POST git/refs',
      'POST pulls',
    ]);
    // Text in the tree itself, and the image as a blob of its own.
    expect(calls[2].body).toEqual({ content: 'iVBORw0KGgo=', encoding: 'base64' });
    expect(calls[3].body).toEqual({
      base_tree: 'basetree',
      tree: [
        {
          path: 'data/providers/netflix.yaml',
          mode: '100644',
          type: 'blob',
          content: 'id: netflix\n',
        },
        { path: 'data/logos/netflix.png', mode: '100644', type: 'blob', sha: 'blob3' },
      ],
    });
    expect(calls[4].body).toMatchObject({ parents: ['base1'], tree: 'tree1' });
    expect(calls[5].body).toEqual({ ref: `refs/heads/${botBranch}`, sha: 'commit1' });
    expect(calls[6].body).toEqual({
      title: made.title,
      head: botBranch,
      base: 'main',
      body: made.body,
    });
  });

  it('refreshes the open pull request instead of opening another, and never merges', async () => {
    const { calls, github } = fakeGitHub(
      [{ number: 3, html_url: 'https://github.com/owner/simply-sub/pull/3' }],
      true,
    );
    expect(await github.propose(state, made, botBranch)).toBe(
      'https://github.com/owner/simply-sub/pull/3',
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET git/ref/heads/${botBranch}`,
      `GET pulls?state=open&head=owner:${botBranch}`,
      'GET git/commits/old',
      'POST git/blobs',
      'POST git/trees',
      'POST git/commits',
      `PATCH git/refs/heads/${botBranch}`,
      'PATCH pulls/3',
    ]);
    expect(calls[6].body).toEqual({ sha: 'commit1', force: true });
    expect(
      calls.some((call) => call.path.includes('merge') || call.path.endsWith('heads/main')),
    ).toBe(false);
  });

  it('never overwrites a review’s commits on its open pull request’s branch', async () => {
    const { calls, github } = fakeGitHub(
      [{ number: 3, html_url: 'https://github.com/owner/simply-sub/pull/3' }],
      true,
      'Review: Netflix Standard is 19.99 CAD',
    );
    expect(await github.propose(state, made, botBranch)).toBe(
      'https://github.com/owner/simply-sub/pull/3',
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET git/ref/heads/${botBranch}`,
      `GET pulls?state=open&head=owner:${botBranch}`,
      'GET git/commits/old',
      'POST issues/3/comments',
    ]);
    expect(calls[3].body).toEqual({
      body: expect.stringContaining('Price updates 2026-10-29 is held'),
    });
  });

  it('rebuilds a branch with a review’s commits once its pull request is merged or closed', async () => {
    const { calls, github } = fakeGitHub([], true, 'Review: Netflix Standard is 19.99 CAD');
    await github.propose(state, made, botBranch);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain(
      `PATCH git/refs/heads/${botBranch}`,
    );
  });

  it('reads the resellers’ websites', () => {
    expect(
      resellerSites(
        '# Resellers\n- id: amazon\n  name: Amazon\n  website: https://www.amazon.com\n- id: inet\n  website: https://www.inet.se\n',
      ),
    ).toEqual([
      { id: 'amazon', website: 'https://www.amazon.com' },
      { id: 'inet', website: 'https://www.inet.se' },
    ]);
  });
});
