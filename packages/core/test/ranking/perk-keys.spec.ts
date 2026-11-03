import { describe, expect, it } from 'vitest';
import {
  featureSummary,
  formatCatalogIssue,
  isPerkKey,
  listItemSchema,
  missingIdIssue,
  missingIds,
  perkFeatures,
  perkKey,
  perkRanks,
  planKeys,
  planPerkKeys,
  planRankCounts,
  providerSchema,
  publishedIds,
  publishedRedirects,
  rankFeatures,
  rankingSections,
  resolveItem,
  sharedRankEdits,
  validateCatalog,
  type CatalogData,
  type CatalogSourceFile,
  type ListItem,
  type Perk,
} from '../../src';
import { catalog as catalogFiles, edited, today } from '../catalog/catalog-files';
import { provider as netflixFixture } from '../catalog/fixtures';
import { issues } from '../catalog/helpers';
import { catalog, item, resolveAll } from '../optimizer/fixtures';

// Ranked perks (M11.6, BLUEPRINT §4.2): a provider's perks with ids, plans listing theirs, each a rank key
// perk:<provider>/<perk> that is ranked on the plan and counted like a feature's.

const netflix = 'data/providers/netflix.yaml';
const mobileGames: Perk = { id: 'mobile-games', name: 'Mobile games' };
const crew = 'perk:game-pass/fortnite-crew';
const online = 'perk:game-pass/online-play';

/** The source catalog with a Netflix perk its Standard plan has. */
function withPerk(files: CatalogSourceFile[] = catalogFiles()): CatalogSourceFile[] {
  return edited(
    edited(files, netflix, ['perks'], [mobileGames]),
    netflix,
    ['plans', 1, 'perks'],
    ['mobile-games'],
  );
}

describe('perk keys', () => {
  it('are perk:<provider>/<perk>, the provider taken from the plan’s id', () => {
    expect(perkKey('game-pass', 'fortnite-crew')).toBe(crew);
    expect(isPerkKey(crew)).toBe(true);
    expect(isPerkKey('video.quality=4k')).toBe(false);
    expect(
      planPerkKeys({ id: 'game-pass.ultimate', perks: ['online-play', 'fortnite-crew'] }),
    ).toEqual([online, crew]);
    expect(planPerkKeys({ id: 'game-pass.free' })).toEqual([]);
  });

  it('come after a plan’s features’ keys', () => {
    const ultimate = catalog.providers
      .find((provider) => provider.id === 'game-pass')
      ?.plans.find((plan) => plan.id === 'game-pass.ultimate');
    const premium = catalog.providers
      .find((provider) => provider.id === 'netflix')
      ?.plans.find((plan) => plan.id === 'netflix.premium');
    expect(ultimate && planKeys(ultimate, catalog.features)).toEqual([online, crew]);
    expect(premium && planKeys(premium, catalog.features)).toContain('video.quality=4k');
  });

  it('are booleans of a Perks category, named as their provider names them', () => {
    expect(perkFeatures(catalog.providers)).toEqual([
      { id: online, name: 'Online console multiplayer', category: 'perks', type: 'boolean' },
      { id: crew, name: 'Fortnite Crew', category: 'perks', type: 'boolean' },
    ]);
    expect(rankFeatures(catalog).slice(0, catalog.features.length)).toEqual(catalog.features);
    expect(rankFeatures(undefined)).toEqual([]);
  });

  it('are ranked in the item dialog’s Perks group, never the Features page’s', () => {
    const categories = [...catalog.categories.feature, { id: 'perks', name: 'Perks' }];
    const page = rankingSections(catalog.features, categories);
    expect(page.flatMap((section) => section.keys)).not.toContain(crew);
    const dialog = rankingSections(rankFeatures(catalog), categories);
    expect(dialog.at(-1)?.category.name).toBe('Perks');
    expect(dialog.at(-1)?.keys).toEqual([online, crew]);
  });
});

describe('the provider file', () => {
  it('lists each perk once, with a name, and each one a plan lists', () => {
    const provider = { ...netflixFixture, perks: [mobileGames, mobileGames] };
    expect(issues(providerSchema, provider)).toEqual([
      'perks.1.id: "mobile-games" is listed more than once',
    ]);
    const unused = {
      ...netflixFixture,
      perks: [mobileGames, { id: 'downloads', name: 'Downloads' }],
    };
    expect(issues(providerSchema, unused)).toEqual([
      'perks.1.id: No plan lists "downloads": list it on the plans that have it, or remove it',
    ]);
  });

  it('takes a plan’s perks only from its provider’s', () => {
    const plans = netflixFixture.plans.map((plan, index) =>
      index === 0 ? { ...plan, perks: ['mobile-gamez'] } : plan,
    );
    expect(issues(providerSchema, { ...netflixFixture, plans })).toEqual([
      "plans.0.perks.0: \"mobile-gamez\" isn't one of netflix's perks (mobile-games): add it to the provider's perks with its name",
    ]);
  });
});

describe('ranks in users’ data', () => {
  it('take a perk’s key as an item’s own rank', () => {
    const [netflixItem] = resolveAll([item('netflix.premium')]);
    const ranked = { ...netflixItem.item, rankOverrides: { [crew]: 'needed' } };
    expect(listItemSchema.safeParse(ranked).success).toBe(true);
    const bad = { ...netflixItem.item, rankOverrides: { 'perk:game-pass': 'needed' } };
    expect(listItemSchema.safeParse(bad).success).toBe(false);
  });
});

describe('the ids guard', () => {
  it('keeps a published perk: gone, it fails, unless it’s redirected', () => {
    const main = withPerk();
    expect(publishedIds(main).filter(({ kind }) => kind === 'perk')).toEqual([
      { kind: 'perk', id: 'perk:netflix/mobile-games', file: netflix },
    ]);
    const branch = catalogFiles();
    expect(
      missingIds(publishedIds(main), publishedIds(branch), publishedRedirects(branch)).map((id) =>
        formatCatalogIssue(missingIdIssue(id)),
      ),
    ).toEqual([
      `${netflix}: Perk "perk:netflix/mobile-games" is published on main and gone here. Ids are permanent, since users' lists, ranks and links point at them (BLUEPRINT §4.3): keep it in its provider's perks under its new name, or redirect it in data/redirects.yaml ({ kind: perk, from: perk:netflix/mobile-games, to: <its new perk key, or the feature rank key it became>, on: <date> })`,
    ]);
    const redirected = [
      ...branch,
      {
        file: 'data/redirects.yaml',
        data: [
          { kind: 'perk', from: 'perk:netflix/mobile-games', to: 'streaming.ad-free', on: today },
        ],
      },
    ];
    expect(
      missingIds(publishedIds(main), publishedIds(redirected), publishedRedirects(redirected)),
    ).toEqual([]);
  });
});

describe('redirects of perks', () => {
  const messages = (files: CatalogSourceFile[]) =>
    validateCatalog(files, today).map((issue) => formatCatalogIssue(issue));
  const redirect = (from: string, to: string): CatalogSourceFile => ({
    file: 'data/redirects.yaml',
    data: [{ kind: 'perk', from, to, on: today }],
  });

  it('moves a perk that’s gone to a feature’s key or another perk', () => {
    expect(
      messages([...withPerk(), redirect('perk:netflix/old-games', 'perk:netflix/mobile-games')]),
    ).toEqual([]);
    expect(
      messages([...catalogFiles(), redirect('perk:netflix/mobile-games', 'streaming.ad-free')]),
    ).toEqual([]);
  });

  it('refuses a perk still offered, and a target that isn’t one', () => {
    expect(
      messages([...withPerk(), redirect('perk:netflix/mobile-games', 'streaming.ad-free')]),
    ).toEqual([
      'data/redirects.yaml 0.from: "perk:netflix/mobile-games" is still a perk of its provider: a redirect is for a perk that\'s gone',
    ]);
    expect(
      messages([...withPerk(), redirect('perk:netflix/old-games', 'perk:netflix/mobile-gamez')]),
    ).toEqual([
      'data/redirects.yaml 0.to: "perk:netflix/mobile-gamez" isn\'t one of netflix\'s perks (did you mean perk:netflix/mobile-games?)',
    ]);
  });
});

describe('an item’s keys, summary and Search’s counts', () => {
  it('give an item its plan’s perks, and a bundle its plans’ perks', () => {
    const [ultimate] = resolveAll([item('game-pass.ultimate')]);
    expect(ultimate.providedKeys).toEqual([online, crew]);
    const bundled: CatalogData = {
      ...catalog,
      bundles: [
        {
          id: 'bundle.game-pass-netflix',
          name: 'Game Pass and Netflix',
          soldBy: 'game-pass',
          includes: ['game-pass.ultimate', 'netflix.premium'],
          link: 'https://game-pass.example.com/bundle',
          prices: [
            {
              region: 'CA',
              currency: 'CAD',
              amount: 40,
              interval: 'month',
              intervalCount: 1,
              autoRenew: true,
              lastVerified: '2026-10-01',
            },
          ],
        },
      ],
    };
    const place = { country: 'CA', subdivision: 'CA-AB' };
    const resolution = resolveItem(item('bundle.game-pass-netflix'), {
      catalog: bundled,
      customSubs: new Map(),
      today,
      country: 'CA',
      currency: 'CAD',
      place,
      taxPlace: place,
      profileRanks: new Map(),
    });
    expect(resolution.ok && resolution.resolved.providedKeys).toEqual(
      expect.arrayContaining(['video.quality=4k', online, crew]),
    );
  });

  it('show a perk in the feature summary only when it’s ranked, named as its provider names it', () => {
    const items = resolveAll([
      item('game-pass.ultimate', {}, { rankOverrides: { [crew]: 'needed' } }),
    ]);
    expect(featureSummary(items, rankFeatures(catalog), today)).toEqual([
      { key: crew, label: 'Fortnite Crew', active: 1, total: 1 },
    ]);
  });

  it('count a perk in Search as the user’s lists rank it, the most important rank', () => {
    const lists: ListItem[] = [
      item('game-pass.ultimate', {}, { rankOverrides: { [crew]: 'wanted' } }),
      item(
        'game-pass.ultimate',
        {},
        { rankOverrides: { [crew]: 'needed', 'video.hdr': 'needed' } },
      ),
      item('game-pass.essential', {}, { rankOverrides: { [online]: 'unused' }, deletedAt: today }),
    ];
    const ranks = perkRanks(lists);
    expect([...ranks]).toEqual([[crew, 'needed']]);
    const ultimate = {
      id: 'game-pass.ultimate',
      features: {},
      perks: ['online-play', 'fortnite-crew'],
    };
    expect(planRankCounts(ultimate, catalog.features, new Map(), ranks)).toMatchObject({
      needed: 1,
      unused: 0,
    });
  });

  it('share a perk’s rank with the provider’s other plans in the list that have it', () => {
    const ultimate = item('game-pass.ultimate');
    const second = item('game-pass.ultimate');
    const essential = item('game-pass.essential');
    const edits = sharedRankEdits(ultimate, new Map([[crew, 'needed']]), [
      { item: ultimate, providedKeys: [online, crew] },
      { item: second, providedKeys: [online, crew] },
      { item: essential, providedKeys: [online] },
    ]);
    expect(edits).toEqual([
      { kind: 'change', itemId: second.id, changes: { rankOverrides: { [crew]: 'needed' } } },
    ]);
  });
});
