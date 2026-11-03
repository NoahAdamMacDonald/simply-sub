import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PolicyCache } from '@simply-sub/core';
import { plantRows, storedRows, testStorage, type TestStorage } from '../storage/storage.testing';
import { CatalogStore } from './catalog-store';
import { PolicyFiles } from './policy-files';

const v1 = '1111111';
const v2 = '2222222';

// A provider's Terms and policies file as data:build writes it (M11.8), naming a shared document, and that document.
const proton = {
  id: 'proton',
  policies: {
    shared: ['swiss-privacy'],
    links: [{ name: 'Terms of service', url: 'https://proton.me/legal/terms' }],
    ratings: [
      {
        topic: 'legal.disputes',
        tier: 'good',
        reason: 'The courts of Geneva.',
        sources: [{ url: 'https://proton.me/legal/terms', quote: 'the courts of Geneva' }],
        lastVerified: '2026-10-22',
      },
    ],
  },
};
const swissPrivacy = {
  id: 'swiss-privacy',
  name: 'A made-up shared privacy policy, for the test',
  links: [{ name: 'Privacy policy', url: 'https://example.com/privacy' }],
  ratings: [
    {
      topic: 'privacy.data-collection',
      tier: 'great',
      reason: 'Only what it needs.',
      sources: [{ url: 'https://example.com/privacy', quote: 'We collect only what we need' }],
      lastVerified: '2026-10-22',
    },
  ],
};

describe('PolicyFiles', () => {
  let storage: TestStorage;
  let version: ReturnType<typeof signal<string | undefined>>;
  let requests: string[];
  let down: boolean;
  let files: Map<string, unknown>;

  beforeEach(() => {
    storage = testStorage();
    version = signal<string | undefined>(v1);
    requests = [];
    down = false;
    files = new Map<string, unknown>([
      ['data/policies/proton.json', proton],
      ['data/policies/shared/swiss-privacy.json', swissPrivacy],
    ]);
    // The static files, as the Worker serves them: a missing one is answered with the app's index.html.
    vi.stubGlobal('fetch', async (path: string) => {
      requests.push(path);
      if (down) throw new TypeError('Failed to fetch');
      const body = files.get(path);
      return body === undefined
        ? new Response('<!doctype html><title>Simply Sub</title>', {
            headers: { 'Content-Type': 'text/html' },
          })
        : Response.json(body);
    });
    TestBed.configureTestingModule({
      providers: [...storage.providers, { provide: CatalogStore, useValue: { version } }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const kept = async () =>
    ((await storedRows(storage.indexedDB, 'catalogCache')) as PolicyCache[]).map(
      ({ key, catalogVersion }) => `${key} ${catalogVersion}`,
    );

  it('downloads a provider’s file and the shared documents it names, and keeps each one', async () => {
    const load = await TestBed.inject(PolicyFiles).load('proton');

    expect(load).toEqual({ status: 'ready', policies: proton.policies, sets: [swissPrivacy] });
    expect(requests).toEqual([
      'data/policies/proton.json',
      'data/policies/shared/swiss-privacy.json',
    ]);
    expect(await kept()).toEqual([`policies/proton ${v1}`, `policies/shared/swiss-privacy ${v1}`]);
  });

  it('uses the files it kept under the catalog’s version, without asking the server', async () => {
    const policyFiles = TestBed.inject(PolicyFiles);
    await policyFiles.load('proton');
    requests = [];

    expect((await policyFiles.load('proton')).status).toBe('ready');
    expect(requests).toEqual([]);
  });

  it('reads them again after a new catalog version', async () => {
    const policyFiles = TestBed.inject(PolicyFiles);
    await policyFiles.load('proton');
    version.set(v2);
    requests = [];

    expect((await policyFiles.load('proton')).status).toBe('ready');
    expect(requests).toHaveLength(2);
    expect(await kept()).toEqual([`policies/proton ${v2}`, `policies/shared/swiss-privacy ${v2}`]);
  });

  it('shows the files it kept offline, whatever their version', async () => {
    await plantRows(storage.indexedDB, 'catalogCache', [
      { key: 'policies/proton', file: proton, catalogVersion: v1, fetchedAt: storage.clock.time },
      {
        key: 'policies/shared/swiss-privacy',
        file: swissPrivacy,
        catalogVersion: v1,
        fetchedAt: storage.clock.time,
      },
    ]);
    version.set(v2);
    down = true;

    expect(await TestBed.inject(PolicyFiles).load('proton')).toEqual({
      status: 'ready',
      policies: proton.policies,
      sets: [swissPrivacy],
    });
  });

  it('says they need a connection when it has none of them offline', async () => {
    down = true;

    expect(await TestBed.inject(PolicyFiles).load('proton')).toEqual({ status: 'offline' });
    expect(await kept()).toEqual([]);
  });

  it('fails on a file that isn’t one, and keeps nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    files.set('data/policies/proton.json', { id: 'proton', policies: { ratings: [] } });

    expect(await TestBed.inject(PolicyFiles).load('proton')).toEqual({ status: 'failed' });
    expect(await TestBed.inject(PolicyFiles).load('mullvad')).toEqual({ status: 'failed' });
    expect(logged).toHaveBeenCalledTimes(2);
    expect(await kept()).toEqual([]);
  });

  it('asks the server nothing before the catalog has a version', async () => {
    version.set(undefined);

    expect(await TestBed.inject(PolicyFiles).load('proton')).toEqual({ status: 'offline' });
    expect(requests).toEqual([]);
  });
});
