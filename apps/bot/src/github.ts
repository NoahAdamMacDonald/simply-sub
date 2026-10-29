import { userAgent } from '@simply-sub/core';
import type { FileChange, Proposal } from './proposal';

// The bot's way to GitHub (BLUEPRINT §7.7): the REST API with a fine-grained token for this repository only (Contents
// and Pull requests, read and write). It reads the base branch, commits the night's changes on one branch of its own,
// and opens or refreshes one pull request. It never merges, and never pushes to the base branch.

/** The one branch the bot commits to: rebuilt from the base branch every night it has changes. */
export const botBranch = 'bot/price-updates';

export interface GitHubOptions {
  token: string;
  /** owner/name. */
  repository: string;
  /** The branch pull requests go into. */
  base: string;
  fetch?: typeof fetch;
}

/** What the bot reads of the base branch. */
export interface RepositoryState {
  /** The base branch's commit and its tree. */
  commit: string;
  tree: string;
  /** Each committed logo's Git blob hash, by provider or reseller id. */
  logos: Record<string, string>;
  /** Each reseller's id and website, from data/resellers.yaml. */
  resellers: { id: string; website: string }[];
}

export class GitHub {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: GitHubOptions) {
    this.fetcher = options.fetch ?? fetch;
  }

  /** The base branch's head, its logos and its resellers. */
  async state(): Promise<RepositoryState> {
    const ref = await this.call<{ object: { sha: string } }>(
      'GET',
      `git/ref/heads/${this.options.base}`,
    );
    const commit = ref.object.sha;
    const { tree } = await this.call<{ tree: { sha: string } }>('GET', `git/commits/${commit}`);
    const listing = await this.call<{ name: string; sha: string; type: string }[]>(
      'GET',
      `contents/data/logos?ref=${commit}`,
    );
    const logos = Object.fromEntries(
      listing
        .filter((entry) => entry.type === 'file' && entry.name.endsWith('.png'))
        .map((entry) => [entry.name.slice(0, -'.png'.length), entry.sha]),
    );
    const resellers = resellerSites(await this.text('data/resellers.yaml', commit));
    return { commit, tree: tree.sha, logos, resellers };
  }

  /** A text file as the commit (or branch) has it. */
  async text(path: string, ref: string): Promise<string> {
    return new TextDecoder().decode(await this.bytes(path, ref));
  }

  /** A file's bytes as the commit (or branch) has it: the contents API gives files up to 1 MB. */
  async bytes(path: string, ref: string): Promise<Uint8Array> {
    const file = await this.call<{ content: string }>('GET', `contents/${path}?ref=${ref}`);
    const binary = atob(file.content.replace(/\s/g, ''));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  /**
   * Commits `proposal`'s changes on the bot's branch, made afresh from the base branch's `state`, and opens its pull
   * request, or gives the open one tonight's title and body. Returns the pull request's URL.
   */
  async propose(state: RepositoryState, proposal: Proposal): Promise<string> {
    const entries = [];
    for (const change of proposal.changes) entries.push(await this.blob(change));
    const tree = await this.call<{ sha: string }>('POST', 'git/trees', {
      base_tree: state.tree,
      tree: entries,
    });
    const commit = await this.call<{ sha: string }>('POST', 'git/commits', {
      message: `${proposal.title}\n\nThe nightly price check (BLUEPRINT §6.4). Review before merging.`,
      tree: tree.sha,
      parents: [state.commit],
    });
    const exists = await this.call<unknown>('GET', `git/ref/heads/${botBranch}`, undefined, true);
    if (exists === undefined) {
      await this.call('POST', 'git/refs', { ref: `refs/heads/${botBranch}`, sha: commit.sha });
    } else {
      // The branch is the bot's own: rebuilt every night, so last night's changes don't pile up.
      await this.call('PATCH', `git/refs/heads/${botBranch}`, { sha: commit.sha, force: true });
    }
    const [owner] = this.options.repository.split('/');
    const open = await this.call<{ number: number; html_url: string }[]>(
      'GET',
      `pulls?state=open&head=${owner}:${botBranch}`,
    );
    if (open[0]) {
      await this.call('PATCH', `pulls/${open[0].number}`, {
        title: proposal.title,
        body: proposal.body,
      });
      return open[0].html_url;
    }
    const created = await this.call<{ html_url: string }>('POST', 'pulls', {
      title: proposal.title,
      head: botBranch,
      base: this.options.base,
      body: proposal.body,
    });
    return created.html_url;
  }

  private async blob(
    change: FileChange,
  ): Promise<{ path: string; mode: string; type: string; sha: string }> {
    const blob = await this.call<{ sha: string }>(
      'POST',
      'git/blobs',
      change.base64 !== undefined
        ? { content: change.base64, encoding: 'base64' }
        : { content: change.text ?? '', encoding: 'utf-8' },
    );
    return { path: change.path, mode: '100644', type: 'blob', sha: blob.sha };
  }

  /** One REST call. With `missingIsUndefined`, a 404 is undefined rather than an error. */
  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    missingIsUndefined = false,
  ): Promise<T> {
    const response = await this.fetcher(
      `https://api.github.com/repos/${this.options.repository}/${path}`,
      {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.options.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': userAgent,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
    );
    if (missingIsUndefined && response.status === 404) return undefined as T;
    if (!response.ok) {
      // The status alone: GitHub's message can quote the request.
      throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${response.status}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}

/** Each reseller's id and website, read from data/resellers.yaml's `- id:` items and their `website:` lines. */
export function resellerSites(yaml: string): { id: string; website: string }[] {
  const sites: { id: string; website: string }[] = [];
  let id: string | undefined;
  for (const line of yaml.split('\n')) {
    const item = /^- id:\s*(\S+)/.exec(line);
    if (item) id = item[1];
    const website = /^\s+website:\s*(\S+)/.exec(line);
    if (website && id) {
      sites.push({ id, website: website[1] });
      id = undefined;
    }
  }
  return sites;
}
