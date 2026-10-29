import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  idFromName,
  mergeCandidates,
  nextQueued,
  onSites,
  providerSiteKeys,
  queueFileSchema,
  siteKey,
  withQueueStatus,
  type QueueEntry,
} from '../../src';
import { issues } from '../catalog/helpers';

function entry(id: string, overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id,
    name: id,
    website: `https://www.${id}.com`,
    category: 'streaming',
    source: 'wikidata',
    status: 'queued',
    ...overrides,
  };
}

describe('queueFileSchema', () => {
  it('accepts own and Wikidata entries in any status', () => {
    expect(
      issues(queueFileSchema, [
        entry('bitdefender', { source: 'own', category: 'privacy-suite' }),
        entry('netflix', { status: 'done', date: '2026-10-28' }),
        entry('spotify', { wikidata: 'Q689141', sitelinks: 104 }),
        entry('vk', { status: 'out-of-scope', note: 'A social network, not a subscription' }),
      ]),
    ).toEqual([]);
  });

  it('wants a note for a service left out, so nobody adds it again', () => {
    expect(issues(queueFileSchema, [entry('hbo-max', { status: 'unreadable' })])).toEqual([
      "0.status: Say why it's unreadable in a note, so nobody adds it again",
    ]);
  });

  it('refuses the same id or the same site twice', () => {
    expect(
      issues(queueFileSchema, [
        entry('spotify'),
        entry('spotify', { website: 'https://open.spotify.com' }),
        entry('spotify-premium', { website: 'https://spotify.com/' }),
      ]),
    ).toEqual([
      '1.id: "spotify" is listed more than once',
      '2.website: "spotify.com" is listed more than once',
    ]);
  });

  it('checks the formats', () => {
    expect(
      issues(queueFileSchema, [
        entry('Disney+', { website: 'http://disneyplus.com', wikidata: '54958752' }),
      ]),
    ).toEqual([
      '0.id: Use a kebab-case id: lowercase letters and digits, joined by single hyphens (disney-plus)',
      '0.website: Use a full https:// URL',
      '0.wikidata: Use a Wikidata item id (Q907311)',
    ]);
  });
});

describe('siteKey', () => {
  it.each([
    ['https://www.netflix.com/', 'netflix.com'],
    ['https://Netflix.com', 'netflix.com'],
    ['https://www.xbox.com/xbox-game-pass/', 'xbox.com/xbox-game-pass'],
    ['http://music.youtube.com/?hl=en#top', 'music.youtube.com'],
    ['https://www.apple.com/Apple-TV-Plus', 'apple.com/apple-tv-plus'],
  ])('reads %s as %s', (url, key) => {
    expect(siteKey(url)).toBe(key);
  });

  it('is undefined for something that is not a web address', () => {
    expect(siteKey('netflix.com')).toBeUndefined();
    expect(siteKey('mailto:help@netflix.com')).toBeUndefined();
  });
});

describe('onSites', () => {
  const proton = providerSiteKeys({ website: 'https://proton.me', domains: ['protonvpn.com'] });

  it('covers a provider site and its pages', () => {
    expect(proton).toEqual(['proton.me', 'protonvpn.com']);
    expect(onSites('https://proton.me/mail', proton)).toBe(true);
    expect(onSites('https://www.protonvpn.com', proton)).toBe(true);
  });

  it('leaves out other sites, even ones that start the same', () => {
    expect(onSites('https://proton.mex', proton)).toBe(false);
    expect(onSites('https://account.proton.me', proton)).toBe(false);
  });
});

describe('nextQueued', () => {
  const queue = [
    entry('bitdefender', { source: 'own' }),
    entry('netflix', { status: 'done' }),
    entry('claude', { source: 'own' }),
    entry('spotify'),
    entry('vk', { status: 'out-of-scope', note: 'A social network' }),
    entry('tidal'),
  ];

  it('takes queued entries in the queue order', () => {
    expect(nextQueued(queue, 3).map(({ id }) => id)).toEqual(['bitdefender', 'claude', 'spotify']);
  });

  it('skips the ones a pull request already has', () => {
    expect(nextQueued(queue, 2, new Set(['claude'])).map(({ id }) => id)).toEqual([
      'bitdefender',
      'spotify',
    ]);
  });
});

describe('mergeCandidates', () => {
  const catalog = {
    ids: ['proton', 'netflix'],
    sites: ['proton.me', 'protonvpn.com', 'netflix.com'],
  };
  const queue = [
    entry('bitdefender', {
      source: 'own',
      website: 'https://www.bitdefender.com',
      wikidata: 'Q854605',
    }),
    entry('youtube', { website: 'https://www.youtube.com', wikidata: 'Q866' }),
  ];

  it('adds new services at the end, queued, in their order', () => {
    const { added, skipped } = mergeCandidates(
      queue,
      [
        {
          id: 'spotify',
          name: 'Spotify',
          website: 'https://www.spotify.com',
          category: 'music',
          wikidata: 'Q689141',
          sitelinks: 104,
        },
        { id: 'tidal', name: 'Tidal', website: 'https://tidal.com', category: 'music' },
      ],
      catalog,
    );
    expect(added).toEqual([
      {
        id: 'spotify',
        name: 'Spotify',
        website: 'https://www.spotify.com',
        category: 'music',
        source: 'wikidata',
        wikidata: 'Q689141',
        sitelinks: 104,
        status: 'queued',
      },
      {
        id: 'tidal',
        name: 'Tidal',
        website: 'https://tidal.com',
        category: 'music',
        source: 'wikidata',
        status: 'queued',
      },
    ]);
    expect(skipped).toEqual([]);
  });

  it("leaves out the catalog's providers, by site or id", () => {
    const { added, skipped } = mergeCandidates(
      queue,
      [
        {
          id: 'proton-mail',
          name: 'Proton Mail',
          website: 'https://proton.me/mail',
          category: 'software',
        },
        { id: 'proton-vpn', name: 'Proton VPN', website: 'https://protonvpn.com', category: 'vpn' },
        {
          id: 'netflix',
          name: 'Netflix',
          website: 'https://netflix.example',
          category: 'streaming',
        },
      ],
      catalog,
    );
    expect(added).toEqual([]);
    expect(skipped.map(({ candidate, reason }) => `${candidate.id} ${reason}`)).toEqual([
      'proton-mail in-catalog',
      'proton-vpn in-catalog',
      'netflix in-catalog',
    ]);
  });

  it('leaves out what the queue has, by Wikidata item or the same site, but not a page on its site', () => {
    const { added, skipped } = mergeCandidates(
      queue,
      [
        {
          id: 'bitdefender-antivirus',
          name: 'Bitdefender Antivirus',
          website: 'https://bitdefender.example',
          category: 'privacy-suite',
          wikidata: 'Q854605',
        },
        { id: 'yt', name: 'YT', website: 'https://youtube.com/', category: 'streaming' },
        {
          id: 'youtube-premium',
          name: 'YouTube Premium',
          website: 'https://www.youtube.com/premium',
          category: 'streaming',
        },
      ],
      catalog,
    );
    expect(added.map(({ id }) => id)).toEqual(['youtube-premium']);
    expect(skipped.map(({ candidate, reason }) => `${candidate.id} ${reason}`)).toEqual([
      'bitdefender-antivirus in-queue',
      'yt in-queue',
    ]);
  });

  it('leaves out a service whose id another one has, for a person to name', () => {
    const { added, skipped } = mergeCandidates(
      queue,
      [
        {
          id: 'youtube',
          name: 'YouTube (Brazil)',
          website: 'https://youtube.com.br',
          category: 'streaming',
        },
        { id: 'tidal', name: 'Tidal', website: 'https://tidal.com', category: 'music' },
        { id: 'tidal', name: 'Tidal Hi-Fi', website: 'https://tidal.example', category: 'music' },
      ],
      catalog,
    );
    expect(added.map(({ id }) => id)).toEqual(['tidal']);
    expect(skipped.map(({ candidate, reason }) => `${candidate.name} ${reason}`)).toEqual([
      'YouTube (Brazil) id-taken',
      'Tidal Hi-Fi id-taken',
    ]);
  });
});

describe('idFromName', () => {
  it.each([
    ['Disney+', 'disney-plus'],
    ['Apple TV+', 'apple-tv-plus'],
    ['Xbox Game Pass', 'xbox-game-pass'],
    ['1Password', '1password'],
    ['Süddeutsche Zeitung', 'suddeutsche-zeitung'],
    ['AT&T TV', 'at-and-t-tv'],
    ["People's Daily", 'people-s-daily'],
    ['Mega.io', 'mega-io'],
    ['!!!', ''],
  ])('makes %s %s', (name, id) => {
    expect(idFromName(name)).toBe(id);
  });
});

describe('withQueueStatus', () => {
  const text = [
    '# The queue.',
    '- id: bitdefender',
    '  name: Bitdefender',
    '  website: https://www.bitdefender.com',
    '  category: privacy-suite',
    '  source: own',
    '  status: queued',
    '- id: claude',
    '  name: Claude',
    '  website: https://claude.com',
    '  category: ai',
    '  source: own',
    '  status: queued',
    '',
    '# Wikidata.',
    '- id: hulu',
    '  name: Hulu',
    '  website: https://www.hulu.com',
    '  category: streaming',
    '  source: wikidata',
    '  status: queued',
    '',
  ].join('\n');

  it('changes one entry, keeping the rest of the file and Prettier’s layout', async () => {
    const done = withQueueStatus(text, 'bitdefender', { status: 'done', date: '2026-11-02' });
    expect(done).toBe(
      text.replace(
        '  status: queued\n- id: claude',
        '  status: done\n  date: 2026-11-02\n- id: claude',
      ),
    );
    const left = withQueueStatus(done ?? '', 'claude', {
      status: 'unreadable',
      date: '2026-11-02',
      note: 'Its prices are on a page that shows the bot an error: a person reads it',
    });
    expect(left).toContain(
      "  status: unreadable\n  date: 2026-11-02\n  note: 'Its prices are on a page that shows the bot an error: a person reads it'\n\n# Wikidata.",
    );
    expect(queueFileSchema.parse(parse(left ?? ''))).toHaveLength(3);
    expect(await format(left ?? '', { parser: 'yaml', printWidth: 100, singleQuote: true })).toBe(
      left,
    );
    // Its status set again, not added twice.
    expect(
      withQueueStatus(left ?? '', 'claude', { status: 'queued', date: '2026-11-09' })?.match(
        /status:/g,
      ),
    ).toHaveLength(3);
  });

  it('says when the entry isn’t there', () => {
    expect(
      withQueueStatus(text, 'netflix', { status: 'done', date: '2026-11-02' }),
    ).toBeUndefined();
  });
});
