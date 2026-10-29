import { describe, expect, it } from 'vitest';
import { digestBranch as botBranch } from '../src/digest';
import { GitHub, resellerSites } from '../src/github';
import type { Proposal } from '../src/proposal';

// The pull request through GitHub's REST API, against a fake GitHub that records every call: one branch of the bot's
// own, rebuilt from the base branch, one pull request opened or refreshed, never a merge or a push to main.

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function fakeGitHub(open: { number: number; html_url: string }[], branch: boolean) {
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
      'POST git/blobs',
      'POST git/blobs',
      'POST git/trees',
      'POST git/commits',
      `GET git/ref/heads/${botBranch}`,
      'POST git/refs',
      `GET pulls?state=open&head=owner:${botBranch}`,
      'POST pulls',
    ]);
    expect(calls[0].body).toEqual({ content: 'id: netflix\n', encoding: 'utf-8' });
    expect(calls[1].body).toEqual({ content: 'iVBORw0KGgo=', encoding: 'base64' });
    expect(calls[2].body).toMatchObject({ base_tree: 'basetree' });
    expect(calls[3].body).toMatchObject({ parents: ['base1'], tree: 'tree1' });
    expect(calls[5].body).toEqual({ ref: `refs/heads/${botBranch}`, sha: 'commit1' });
    expect(calls[7].body).toEqual({
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
    expect(calls.slice(5).map((call) => `${call.method} ${call.path}`)).toEqual([
      `PATCH git/refs/heads/${botBranch}`,
      `GET pulls?state=open&head=owner:${botBranch}`,
      'PATCH pulls/3',
    ]);
    expect(calls[5].body).toEqual({ sha: 'commit1', force: true });
    expect(
      calls.some((call) => call.path.includes('merge') || call.path.endsWith('heads/main')),
    ).toBe(false);
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
