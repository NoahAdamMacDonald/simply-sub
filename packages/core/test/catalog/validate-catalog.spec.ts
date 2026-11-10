import { describe, expect, it } from 'vitest';
import { formatCatalogIssue, validateCatalog, type CatalogSourceFile } from '../../src';
import { catalog, catalogWith, edited, price, today } from './catalog-files';
import { asciiBytes, pngBytes } from './helpers';

const bundleFile = 'data/bundles/netflix-crave.yaml';
const categoriesFile = 'data/categories.yaml';
const featuresFile = 'data/features.yaml';
const crave = 'data/providers/crave.yaml';
const mullvad = 'data/providers/mullvad.yaml';
const netflix = 'data/providers/netflix.yaml';
const proton = 'data/providers/proton.yaml';

/** Each issue as validate-data prints it, without line numbers; warnings start with `warning: `. */
function messages(files: readonly CatalogSourceFile[], on = today): string[] {
  return validateCatalog(files, on).map(
    (issue) => `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
  );
}

/** The messages for the valid catalog with one value changed. */
function messagesWith(file: string, path: (string | number)[], value: unknown): string[] {
  return messages(catalogWith(file, path, value));
}

/** The catalog with `file` replaced, or added when it isn't there. */
function withFile(files: CatalogSourceFile[], source: CatalogSourceFile): CatalogSourceFile[] {
  return [...files.filter(({ file }) => file !== source.file), source];
}

function dataOf(files: readonly CatalogSourceFile[], file: string): unknown {
  const source = files.find((candidate) => candidate.file === file);
  if (!source || !('data' in source)) {
    throw new Error(`No data for ${file}`);
  }
  return source.data;
}

describe('validateCatalog', () => {
  it('accepts a valid catalog', () => {
    expect(messages(catalog())).toEqual([]);
  });

  describe('files', () => {
    it.each([
      [
        'data/notes.yaml',
        'data/notes.yaml: Not a catalog file: use data/features.yaml, data/categories.yaml, data/resellers.yaml, data/policy-topics.yaml, data/queue.yaml, data/automation.yaml, data/redirects.yaml, data/raters.yaml, data/bank-of-canada.yaml, data/providers/<id>.yaml, data/bundles/<slug>.yaml or data/policies/<id>.yaml',
      ],
      [
        'data/providers/old/netflix.yaml',
        'data/providers/old/netflix.yaml: Not a catalog file: use data/features.yaml, data/categories.yaml, data/resellers.yaml, data/policy-topics.yaml, data/queue.yaml, data/automation.yaml, data/redirects.yaml, data/raters.yaml, data/bank-of-canada.yaml, data/providers/<id>.yaml, data/bundles/<slug>.yaml or data/policies/<id>.yaml',
      ],
      [
        'data/providers/hulu.yml',
        'data/providers/hulu.yml: Rename it to hulu.yaml: catalog files end in .yaml',
      ],
    ])('rejects %s', (file, expected) => {
      expect(messages([...catalog(), { file, data: {} }])).toEqual([expected]);
    });

    it('needs features.yaml and categories.yaml, and skips the checks that use them', () => {
      const files = catalog().filter(
        ({ file }) => file !== featuresFile && file !== categoriesFile,
      );
      expect(messages(files)).toEqual([
        'data/features.yaml: Missing: the feature registry goes here (BLUEPRINT §4.2)',
        'data/categories.yaml: Missing: the service, feature and spend categories go here (BLUEPRINT §4.5)',
      ]);
    });

    it('skips a file that is not valid YAML, and references to it', () => {
      const files = withFile(catalog(), { file: netflix, invalidYaml: true });
      expect(messages(files)).toEqual([]);
    });

    it('skips the feature checks when features.yaml is not valid YAML', () => {
      const files = withFile(
        catalogWith(netflix, ['plans', 0, 'features', 'video.quality'], '8k'),
        { file: featuresFile, invalidYaml: true },
      );
      expect(messages(files)).toEqual([]);
    });

    it('needs kebab-case file names', () => {
      const files = catalog().map((source) =>
        source.file === netflix ? { ...source, file: 'data/providers/Netflix.yaml' } : source,
      );
      expect(messages(files)).toEqual([
        'data/providers/Netflix.yaml: Use a kebab-case file name (disney-plus.yaml)',
      ]);
    });
  });

  describe('schemas', () => {
    it('reports an unknown key at the key, and skips references to the broken file', () => {
      expect(messagesWith(netflix, ['plans', 1, 'addOns'], ['netflix.extra-member'])).toEqual([
        'data/providers/netflix.yaml plans.1.addOns: Unknown key: check the spelling, or remove it',
      ]);
    });

    it("reports the schema's own messages", () => {
      expect(messagesWith(crave, ['plans', 0, 'prices', 0, 'currency'], 'cad')).toEqual([
        'data/providers/crave.yaml plans.0.prices.0.currency: Use a three-letter ISO 4217 currency code in capitals (CAD)',
      ]);
    });

    it('skips plan values of a feature whose own definition is broken', () => {
      const files = edited(
        catalogWith(netflix, ['plans', 0, 'features', 'video.quality'], '8k'),
        featuresFile,
        [0, 'name'],
        ' ',
      );
      expect(messages(files)).toEqual(['data/features.yaml 0.name: Must not be empty']);
    });

    it('skips the feature checks when features.yaml is not a list', () => {
      expect(messages(withFile(catalog(), { file: featuresFile, data: {} }))).toEqual([
        'data/features.yaml: Invalid input: expected array, received object',
      ]);
    });
  });

  describe('ids', () => {
    it("needs a provider's id to be its file name", () => {
      const files = catalog().map((source) =>
        source.file === mullvad ? { ...source, file: 'data/providers/mulvad.yaml' } : source,
      );
      expect(messages(files)).toEqual([
        'data/providers/mulvad.yaml id: Must be mulvad to match the file name, or rename the file',
      ]);
    });

    it('reports a mistyped provider id before the plan ids it breaks, and skips references to it', () => {
      expect(messagesWith(netflix, ['id'], 'netflx')).toEqual([
        'data/providers/netflix.yaml id: Must be netflix to match the file name, or rename the file',
        'data/providers/netflix.yaml plans.0.id: Must start with "netflx."',
        'data/providers/netflix.yaml plans.1.id: Must start with "netflx."',
        'data/providers/netflix.yaml plans.2.id: Must start with "netflx."',
        'data/providers/netflix.yaml addOns.0.id: Must start with "netflx."',
      ]);
    });

    it("needs a bundle's id to be bundle.<file name>", () => {
      const files = catalog().map((source) =>
        source.file === bundleFile
          ? { ...source, file: 'data/bundles/netflix-and-crave.yaml' }
          : source,
      );
      expect(messages(files)).toEqual([
        'data/bundles/netflix-and-crave.yaml id: Must be bundle.netflix-and-crave to match the file name, or rename the file',
      ]);
    });

    it('rejects an id used in two files', () => {
      const provider = {
        id: 'bundle',
        name: 'Bundle',
        website: 'https://example.com',
        category: 'streaming',
        spendCategory: 'streaming',
        cancelUrl: 'https://example.com/cancel',
        // Netflix's owner, ways to pay, renewal day and free use, so only the id is wrong.
        owner: (dataOf(catalog(), netflix) as { owner: unknown }).owner,
        paymentMethods: (dataOf(catalog(), netflix) as { paymentMethods: unknown }).paymentMethods,
        renewalAnchor: (dataOf(catalog(), netflix) as { renewalAnchor: unknown }).renewalAnchor,
        freeUse: (dataOf(catalog(), netflix) as { freeUse: unknown }).freeUse,
        plans: [
          {
            id: 'bundle.netflix-crave',
            name: 'Netflix and Crave',
            link: 'https://example.com/signup',
            features: {},
            prices: (dataOf(catalog(), bundleFile) as { prices: unknown }).prices,
          },
        ],
      };
      expect(
        messages([...catalog(), { file: 'data/providers/bundle.yaml', data: provider }]),
      ).toEqual([
        'data/providers/bundle.yaml plans.0.id: "bundle.netflix-crave" is already the id of a bundle in data/bundles/netflix-crave.yaml',
        'warning: data/providers/bundle.yaml: No logo, so the app shows a letter: run npm run data:icons to fetch data/logos/bundle.png',
      ]);
    });

    it('rejects a feature id listed twice', () => {
      const features = dataOf(catalog(), featuresFile) as unknown[];
      expect(
        messages(withFile(catalog(), { file: featuresFile, data: [...features, features[1]] })),
      ).toEqual(['data/features.yaml 10.id: "streaming.ad-free" is listed more than once']);
    });

    it('rejects a category id listed twice in one list', () => {
      expect(
        messagesWith(categoriesFile, ['service', 3], { id: 'vpn', name: 'VPNs', icon: 'vpn_lock' }),
      ).toEqual(['data/categories.yaml service.3.id: "vpn" is listed more than once']);
    });
  });

  describe('the feature registry', () => {
    it('needs real feature categories', () => {
      expect(messagesWith(featuresFile, [0, 'category'], 'streming')).toEqual([
        'data/features.yaml 0.category: "streming" isn\'t a feature category in data/categories.yaml (streaming, vpn, storage, account, bundle)',
      ]);
    });

    it('keeps provider-wide features out of groups', () => {
      expect(messagesWith(featuresFile, [5, 'providerWide'], true)).toEqual([
        "data/features.yaml 5.providerWide: A provider-wide feature isn't in a group: a plan's vpn.included decides its children, so leave out parent or providerWide",
      ]);
    });

    it.each([
      [
        'a feature that exists',
        5,
        'vpn.include',
        'data/features.yaml 5.parent: "vpn.include" isn\'t a feature (did you mean vpn.included?)',
      ],
      [
        'a boolean feature',
        5,
        'video.quality',
        'data/features.yaml 5.parent: "video.quality" is an enum feature, but a parent must be a boolean group feature',
      ],
      [
        'a top-level feature',
        7,
        'vpn.unlimited-traffic',
        'data/features.yaml 7.parent: "vpn.unlimited-traffic" is in the group vpn.included, and groups are one level deep: use vpn.included',
      ],
      [
        'another feature',
        1,
        'streaming.ad-free',
        "data/features.yaml 1.parent: A feature can't be its own parent",
      ],
    ])('needs a parent to be %s', (_rule, index, parent, expected) => {
      expect(messagesWith(featuresFile, [index, 'parent'], parent)).toEqual([expected]);
    });

    it('needs a group listed before its features, since GET /features keeps the order', () => {
      const features = dataOf(catalog(), featuresFile) as unknown[];
      const vpn = features[4];
      expect(
        messages(
          withFile(catalog(), {
            file: featuresFile,
            data: [...features.filter((feature) => feature !== vpn), vpn],
          }),
        ),
      ).toEqual([
        'data/features.yaml 4.parent: "vpn.included" is listed after this feature: move the group above its features',
        'data/features.yaml 5.parent: "vpn.included" is listed after this feature: move the group above its features',
      ]);
    });
  });

  describe('provider categories', () => {
    it.each([
      [
        'category',
        'streming',
        'data/providers/netflix.yaml category: "streming" isn\'t a service category in data/categories.yaml (streaming, vpn, privacy-suite)',
      ],
      [
        'spendCategory',
        'softwar',
        'data/providers/netflix.yaml spendCategory: "softwar" isn\'t a spend category in data/categories.yaml (streaming, software)',
      ],
    ])('need a real %s', (key, value, expected) => {
      expect(messagesWith(netflix, [key], value)).toEqual([expected]);
    });

    it('need real categories on a plan, other than the provider’s alone', () => {
      expect(messagesWith(netflix, ['plans', 0, 'categories'], ['streaming', 'vpns'])).toEqual([
        'data/providers/netflix.yaml plans.0.categories.1: "vpns" isn\'t a service category in data/categories.yaml (streaming, vpn, privacy-suite)',
      ]);
      expect(messagesWith(netflix, ['plans', 0, 'categories'], ['streaming'])).toEqual([
        "data/providers/netflix.yaml plans.0.categories: streaming is the provider's category already: leave categories out",
      ]);
      expect(
        messagesWith(netflix, ['plans', 0, 'categories'], ['streaming', 'privacy-suite']),
      ).toEqual([]);
    });

    describe('every category a plan fits (M11.3)', () => {
      const storage = { id: 'storage', name: 'Cloud storage', icon: 'cloud' };
      const withStorage = () => edited(catalog(), categoriesFile, ['service', 3], storage);

      it('warns about a category its features name and it isn’t in', () => {
        expect(messages(withStorage())).toEqual(
          [0, 1, 2, 3].map(
            (index) =>
              `warning: data/providers/proton.yaml plans.${index}.categories: Its features say it's in storage (storage.cloud): add storage to its categories, or to notIn when it comes with the plan but isn't what it's sold as`,
          ),
        );
        expect(messagesWith(netflix, ['plans', 0, 'features', 'vpn.included'], true)).toEqual([
          "warning: data/providers/netflix.yaml plans.0.id: Its features say it's in vpn (vpn.included): add vpn to its categories, or to notIn when it comes with the plan but isn't what it's sold as",
        ]);
      });

      it('takes the category, or notIn when it comes with the plan but isn’t what it’s sold as', () => {
        let files = withStorage();
        for (const index of [0, 2, 3]) {
          files = edited(
            files,
            proton,
            ['plans', index, 'categories'],
            ['privacy-suite', 'vpn', 'storage'],
          );
        }
        expect(messages(edited(files, proton, ['plans', 1, 'notIn'], ['storage']))).toEqual([]);
      });

      it('needs notIn to name a category its features name and it isn’t in', () => {
        const notIn = (value: string[]) =>
          messages(edited(withStorage(), proton, ['plans', 1, 'notIn'], value)).filter(
            (message) => !message.startsWith('warning: '),
          );
        expect(notIn(['storage', 'vpns'])).toEqual([
          'data/providers/proton.yaml plans.1.notIn.1: "vpns" isn\'t a service category in data/categories.yaml (streaming, vpn, privacy-suite, storage)',
        ]);
        expect(notIn(['storage', 'vpn'])).toEqual([
          "data/providers/proton.yaml plans.1.notIn.1: It's in vpn: take vpn out of notIn or out of its categories",
        ]);
        expect(notIn(['storage', 'streaming'])).toEqual([
          'data/providers/proton.yaml plans.1.notIn.1: No feature of it names streaming: leave streaming out of notIn',
        ]);
        expect(notIn(['storage', 'storage'])).toEqual([
          'data/providers/proton.yaml plans.1.notIn.1: "storage" is listed more than once',
        ]);
      });
    });
  });

  describe('plan features', () => {
    const features = (index: number) => ['plans', index, 'features'];

    it.each([
      [
        'video.qualty',
        '1080p',
        'plans.0.features.video.qualty: Not a feature in data/features.yaml (did you mean video.quality?)',
      ],
      [
        'audio.atmos',
        true,
        'plans.0.features.audio.atmos: Not a feature in data/features.yaml (add it there first)',
      ],
      ['streaming.ad-free', 'yes', 'plans.0.features.streaming.ad-free: Use true or false'],
      [
        'streaming.concurrent-streams',
        'two',
        'plans.0.features.streaming.concurrent-streams: Use a number of devices, or unlimited',
      ],
      [
        'video.quality',
        '8k',
        'plans.0.features.video.quality: "8k" isn\'t a video.quality value (480p, 720p, 1080p, 4k)',
      ],
      [
        'video.quality',
        1080,
        'plans.0.features.video.quality: Use a video.quality value (480p, 720p, 1080p, 4k)',
      ],
      [
        'streaming.live',
        'sports',
        'plans.0.features.streaming.live: Use a list of streaming.live values, such as [tv-channels]',
      ],
      [
        'streaming.live',
        ['sport'],
        'plans.0.features.streaming.live.0: "sport" isn\'t a streaming.live value (tv-channels, sports)',
      ],
      [
        'streaming.live',
        ['sports', 'sports'],
        'plans.0.features.streaming.live.1: "sports" is listed more than once',
      ],
    ])('%s: %j is rejected', (featureId, value, expected) => {
      expect(messagesWith(netflix, [...features(0), featureId], value)).toEqual([
        `data/providers/netflix.yaml ${expected}`,
      ]);
    });

    it('accepts unlimited for a number feature', () => {
      expect(
        messagesWith(netflix, [...features(0), 'streaming.concurrent-streams'], 'unlimited'),
      ).toEqual([]);
    });

    describe('includes-subscription', () => {
      const included = [...features(2), 'includes-subscription'];

      it('accepts provider and plan ids', () => {
        expect(messagesWith(proton, included, ['proton.vpn-plus', 'mullvad'])).toEqual([]);
      });

      it.each([
        [
          'proton.vnp-plus',
          '"proton.vnp-plus" isn\'t a provider or plan id (did you mean proton.vpn-plus?)',
        ],
        ['netflix.extra-member', '"netflix.extra-member" is an add-on: list provider or plan ids'],
        ['bundle.netflix-crave', '"bundle.netflix-crave" is a bundle: list provider or plan ids'],
        ['proton.unlimited', "A plan can't include itself"],
        ['proton', '"proton" is this plan\'s own provider: list the plans it includes instead'],
      ])('rejects %s', (id, expected) => {
        expect(messagesWith(proton, included, ['proton.vpn-plus', id])).toEqual([
          `data/providers/proton.yaml plans.2.features.includes-subscription.1: ${expected}`,
        ]);
      });

      it('rejects a loop once, at the plan that closes it', () => {
        expect(messagesWith(proton, included, ['proton.vpn-plus', 'proton.duo'])).toEqual([
          "data/providers/proton.yaml plans.3.features.includes-subscription.0: Makes a loop, proton.unlimited → proton.duo → proton.unlimited: a plan can't include a plan that includes it",
        ]);
      });

      it('rejects a loop across files', () => {
        const files = edited(
          catalogWith(mullvad, [...features(0), 'includes-subscription'], ['proton.vpn-plus']),
          proton,
          [...features(1), 'includes-subscription'],
          ['mullvad.vpn'],
        );
        expect(messages(files)).toEqual([
          "data/providers/proton.yaml plans.1.features.includes-subscription.0: Makes a loop, mullvad.vpn → proton.vpn-plus → mullvad.vpn: a plan can't include a plan that includes it",
        ]);
      });
    });

    it.each([
      ['left out', undefined],
      ['false', false],
    ])('needs the group of a child feature, not %s', (_case, value) => {
      expect(messagesWith(mullvad, [...features(0), 'vpn.included'], value)).toEqual([
        'data/providers/mullvad.yaml plans.0.features.vpn.devices: Needs vpn.included: true, the group this feature belongs to',
        'data/providers/mullvad.yaml plans.0.features.vpn.unlimited-traffic: Needs vpn.included: true, the group this feature belongs to',
      ]);
    });
  });

  describe('required features (M11.4)', () => {
    const requiredQuality = () => edited(catalog(), featuresFile, [0, 'requiredIn'], ['streaming']);

    it('needs every plan in the category to state it', () => {
      expect(messages(requiredQuality())).toEqual([
        "data/providers/crave.yaml plans.0.features: Needs video.quality, which every plan in streaming states (requiredIn): give its value, from the provider's own pages",
      ]);
      expect(
        messages(
          edited(requiredQuality(), crave, ['plans', 0, 'features', 'video.quality'], '720p'),
        ),
      ).toEqual([]);
    });

    it('takes false and 0, and leaves out plans in other categories', () => {
      const files = edited(catalog(), featuresFile, [1, 'requiredIn'], ['streaming']);
      const missing = (plan: string, index: number) =>
        `data/providers/${plan}.yaml plans.${index}.features: Needs streaming.ad-free, which every plan in streaming states (requiredIn): give true or false, from the provider's own pages`;
      expect(messages(files)).toEqual([
        missing('crave', 0),
        missing('crave', 1),
        missing('netflix', 0),
      ]);
      expect(
        messages(edited(files, netflix, ['plans', 0, 'features', 'streaming.ad-free'], false)),
      ).toEqual([missing('crave', 0), missing('crave', 1)]);
    });

    it('warns instead for a plan waiting for M11.9', () => {
      const issues = validateCatalog(requiredQuality(), today, {
        awaitingRequired: new Map([['crave.standard', ['video.quality']]]),
      });
      expect(issues.map(({ severity, message }) => [severity, message])).toEqual([
        [
          'warning',
          'Needs video.quality, which every plan in streaming states (requiredIn): no official page states it, or gives a reason to infer it, yet (awaitingRequiredFeatures)',
        ],
      ]);
    });

    it('needs real service categories, each once', () => {
      const registry = messagesWith(featuresFile, [0, 'requiredIn'], ['streming', 'vpn', 'vpn']);
      expect(registry.filter((message) => message.startsWith(featuresFile))).toEqual([
        'data/features.yaml 0.requiredIn.0: "streming" isn\'t a service category in data/categories.yaml (streaming, vpn, privacy-suite)',
        'data/features.yaml 0.requiredIn.2: "vpn" is listed more than once',
      ]);
    });
  });

  describe('provider-wide features (M11.4)', () => {
    const platforms = {
      id: 'platforms',
      name: 'Platforms',
      category: 'streaming',
      type: 'set',
      values: [
        { id: 'web', name: 'Web browser' },
        { id: 'tv', name: 'TVs and streaming devices' },
      ],
      providerWide: true,
    };
    const withPlatforms = (extra: Record<string, unknown> = {}) => {
      const files = catalog();
      const features = dataOf(files, featuresFile) as unknown[];
      return withFile(files, {
        file: featuresFile,
        data: [...features, { ...platforms, ...extra }],
      });
    };

    it('takes only provider-wide features at the provider, each a value of its type', () => {
      const files = withPlatforms();
      expect(messages(edited(files, netflix, ['features'], { platforms: ['web', 'tv'] }))).toEqual(
        [],
      );
      expect(
        messages(
          edited(files, netflix, ['features'], {
            'video.quality': '4k',
            platform: ['web'],
            platforms: ['web', 'phone'],
          }),
        ),
      ).toEqual([
        "data/providers/netflix.yaml features.video.quality: video.quality isn't provider-wide in data/features.yaml: state it on each plan, even when every plan has the same value",
        'data/providers/netflix.yaml features.platform: Not a feature in data/features.yaml (did you mean platforms?)',
        'data/providers/netflix.yaml features.platforms.1: "phone" isn\'t a platforms value (web, tv)',
      ]);
    });

    it('refuses a plan value the provider states already, and takes one that differs', () => {
      const files = edited(withPlatforms(), netflix, ['features'], { platforms: ['web', 'tv'] });
      const plan = ['plans', 0, 'features', 'platforms'];
      expect(messages(edited(files, netflix, plan, ['tv', 'web']))).toEqual([
        "data/providers/netflix.yaml plans.0.features.platforms: Its provider's features say so already: leave it out, or give the value it differs by",
      ]);
      expect(messages(edited(files, netflix, plan, ['web']))).toEqual([]);
    });

    it('counts for required features and price differences', () => {
      const required = withPlatforms({ requiredIn: ['vpn'] });
      const missing = messages(required);
      expect(missing).toContain(
        "data/providers/mullvad.yaml plans.0.features: Needs platforms, which every plan in vpn states (requiredIn): give its values, [] included, from the provider's own pages",
      );
      expect(
        messages(edited(required, mullvad, ['features'], { platforms: ['web'] })).filter(
          (message) => message.includes('mullvad'),
        ),
      ).toEqual([]);
      // Standard's ad-free is its only difference from Standard with ads: the provider's platforms don't make one.
      const same = edited(
        edited(withPlatforms(), netflix, ['features'], { platforms: ['web'] }),
        netflix,
        ['plans', 1, 'features', 'streaming.ad-free'],
        false,
      );
      expect(messages(same)).toHaveLength(1);
      expect(
        messages(edited(same, netflix, ['plans', 1, 'features', 'platforms'], ['web', 'tv'])),
      ).toEqual([]);
    });
  });

  describe('price differences (M11.4)', () => {
    const adFree = ['plans', 1, 'features', 'streaming.ad-free'];
    const warning =
      'warning: data/providers/netflix.yaml plans.1.features: Costs more than netflix.standard-ads (18.99 against 7.99 CAD a month in CA) with the same features and perks: give what the price pays for a feature or a perk, or the optimizer always suggests netflix.standard-ads';

    it('warns when two plans at different prices have the same features', () => {
      expect(messagesWith(netflix, adFree, false)).toEqual([warning]);
      expect(messagesWith(netflix, adFree, true)).toEqual([]);
    });

    it('reads an unlisted value as false, 0 or empty, and a set in any order', () => {
      const files = edited(catalog(), netflix, ['plans', 0, 'features', 'streaming.live'], []);
      expect(messages(edited(files, netflix, adFree, false))).toEqual([warning]);
      const live = (index: number, value: string[]) => (files: CatalogSourceFile[]) =>
        edited(files, netflix, ['plans', index, 'features', 'streaming.live'], value);
      const ordered = live(1, ['sports', 'tv-channels'])(
        live(0, ['tv-channels', 'sports'])(edited(catalog(), netflix, adFree, false)),
      );
      expect(messages(ordered)).toEqual([warning]);
    });

    it('takes a perk as a difference (M11.6)', () => {
      const files = edited(
        edited(catalog(), netflix, adFree, false),
        netflix,
        ['perks'],
        [{ id: 'mobile-games', name: 'Mobile games' }],
      );
      expect(messages(edited(files, netflix, ['plans', 1, 'perks'], ['mobile-games']))).toEqual([]);
      const both = edited(
        edited(files, netflix, ['plans', 1, 'perks'], ['mobile-games']),
        netflix,
        ['plans', 0, 'perks'],
        ['mobile-games'],
      );
      expect(messages(both)).toEqual([warning]);
    });

    it('compares only prices still sold, for the same region, currency and period', () => {
      const files = edited(catalog(), netflix, adFree, false);
      expect(messages(edited(files, netflix, ['plans', 1, 'retired'], '2026-10-01'))).toEqual([]);
      const yearly = edited(
        files,
        netflix,
        ['plans', 0, 'prices'],
        [{ ...price('CA', 'CAD', 79.99), interval: 'year' }],
      );
      expect(messages(yearly)).toEqual([]);
      const sameAmount = edited(files, netflix, ['plans', 1, 'prices'], [price('CA', 'CAD', 7.99)]);
      expect(messages(sameAmount)).toEqual([]);
    });
  });

  describe('featureLabels', () => {
    const labels = ['plans', 1, 'featureLabels'];

    it('accepts feature ids and rank keys', () => {
      expect(
        messagesWith(netflix, labels, {
          'video.quality': 'Picture',
          'video.quality=4k': 'Ultra HD',
          'streaming.live=sports': 'Sports',
          'includes-subscription=proton': 'Proton',
        }),
      ).toEqual([]);
    });

    it.each([
      [
        'video.qualty=4k',
        '"video.qualty" isn\'t a feature in data/features.yaml (did you mean video.quality?)',
      ],
      [
        'streaming.ad-free=yes',
        'streaming.ad-free is a boolean feature, which has no values: use streaming.ad-free alone',
      ],
      ['video.quality=8k', '"8k" isn\'t a video.quality value (480p, 720p, 1080p, 4k)'],
      [
        'streaming.concurrent-streams=3',
        '"3" isn\'t a streaming.concurrent-streams tier (1, 2-4, 5+)',
      ],
      ['storage.cloud=200', 'storage.cloud has no tiers: use storage.cloud alone'],
      ['streaming.live=news', '"news" isn\'t a streaming.live value (tv-channels, sports)'],
      ['includes-subscription=protn', '"protn" isn\'t a provider id (did you mean proton?)'],
    ])('rejects %s', (key, expected) => {
      expect(messagesWith(netflix, labels, { [key]: 'Label' })).toEqual([
        `data/providers/netflix.yaml plans.1.featureLabels.${key}: ${expected}`,
      ]);
    });
  });

  describe('add-ons', () => {
    it('needs addOnIds to name add-ons in the same file', () => {
      expect(messagesWith(netflix, ['plans', 1, 'addOnIds'], ['netflix.extra-membr'])).toEqual([
        'data/providers/netflix.yaml plans.1.addOnIds.0: "netflix.extra-membr" isn\'t an add-on in this file (netflix.extra-member)',
        "data/providers/netflix.yaml addOns.0.id: No plan lists this add-on: add it to the addOnIds of the plans it's sold with",
      ]);
    });

    it('rejects a plan in addOnIds', () => {
      expect(
        messagesWith(
          netflix,
          ['plans', 1, 'addOnIds'],
          ['netflix.extra-member', 'netflix.standard-ads'],
        ),
      ).toEqual([
        'data/providers/netflix.yaml plans.1.addOnIds.1: "netflix.standard-ads" is a plan, not an add-on',
      ]);
    });

    it('says where to add an add-on when the file has none', () => {
      expect(messagesWith(mullvad, ['plans', 0, 'addOnIds'], ['mullvad.extra-device'])).toEqual([
        'data/providers/mullvad.yaml plans.0.addOnIds.0: "mullvad.extra-device" isn\'t an add-on in this file (add it under addOns)',
      ]);
    });

    it('needs every add-on to be sold with a plan', () => {
      const files = edited(
        catalogWith(netflix, ['plans', 1, 'addOnLimit'], undefined),
        netflix,
        ['plans', 1, 'addOnIds'],
        undefined,
      );
      expect(messages(files)).toEqual([
        "data/providers/netflix.yaml addOns.0.id: No plan lists this add-on: add it to the addOnIds of the plans it's sold with",
      ]);
    });

    it.each([
      [
        'netflix.standrd',
        '"netflix.standrd" isn\'t a plan in this file (netflix.standard-ads, netflix.standard, netflix.premium)',
      ],
      [
        'crave.premium',
        '"crave.premium" isn\'t a plan in this file (netflix.standard-ads, netflix.standard, netflix.premium)',
      ],
      ['netflix.extra-member', '"netflix.extra-member" is an add-on: grantsPlan names a plan'],
    ])('needs grantsPlan to be a plan in the same file, not %s', (plan, expected) => {
      expect(messagesWith(netflix, ['addOns', 0, 'grantsPlan'], plan)).toEqual([
        `data/providers/netflix.yaml addOns.0.grantsPlan: ${expected}`,
      ]);
    });
  });

  describe('bundles', () => {
    it('needs soldBy to be a provider', () => {
      expect(messagesWith(bundleFile, ['soldBy'], 'crav')).toEqual([
        'data/bundles/netflix-crave.yaml soldBy: "crav" isn\'t a provider (did you mean crave?)',
      ]);
    });

    it.each([
      ['crave.premum', '"crave.premum" isn\'t a plan (did you mean crave.premium?)'],
      ['crave.starz', '"crave.starz" is an add-on: a bundle includes plans'],
    ])('needs includes to be plans, not %s', (id, expected) => {
      expect(messagesWith(bundleFile, ['includes', 1], id)).toEqual([
        `data/bundles/netflix-crave.yaml includes.1: ${expected}`,
      ]);
    });
  });

  describe('logos', () => {
    const logo = (file: string, bytes: Uint8Array) => withFile(catalog(), { file, bytes });

    it('warns about a provider without a logo', () => {
      const files = catalog().filter(({ file }) => file !== 'data/logos/mullvad.png');
      expect(messages(files)).toEqual([
        'warning: data/providers/mullvad.yaml: No logo, so the app shows a letter: run npm run data:icons to fetch data/logos/mullvad.png',
      ]);
    });

    it.each([
      [
        'data/logos/netflx.png',
        'data/logos/netflx.png: "netflx" isn\'t a provider or reseller id: name the logo after one (did you mean netflix?)',
      ],
      [
        'data/logos/netflix.standard.png',
        'data/logos/netflix.standard.png: "netflix.standard" isn\'t a provider or reseller id: name the logo after one',
      ],
      [
        'data/logos/netflix.svg',
        'data/logos/netflix.svg: Logos are PNG files named after the provider or reseller id (disney-plus.png)',
      ],
    ])('rejects %s', (file, expected) => {
      expect(messages(logo(file, pngBytes(64, 64)))).toEqual([expected]);
    });

    it.each([
      ['an HTML page', asciiBytes('<!doctype html><html></html>'), 'Not a PNG image'],
      [
        'a picture that is not square',
        pngBytes(64, 48),
        'Use a square image of at least 32×32 pixels (this one is 64×48)',
      ],
      [
        'a picture under 32 pixels',
        pngBytes(16, 16),
        'Use a square image of at least 32×32 pixels (this one is 16×16)',
      ],
      [
        'a file over 100 KB',
        pngBytes(64, 64, 100_001),
        'Use an image of at most 100 KB (this one is 101 KB)',
      ],
    ])('rejects %s', (_case, bytes, expected) => {
      expect(messages(logo('data/logos/netflix.png', bytes))).toEqual([
        `data/logos/netflix.png: ${expected}`,
      ]);
    });
  });

  describe('billingCurrency', () => {
    it('needs every priced region, reported once per file', () => {
      expect(messagesWith(netflix, ['billingCurrency'], { CA: 'CAD' })).toEqual([
        'data/providers/netflix.yaml plans.0.prices.1.region: billingCurrency has no US: add US: USD to it',
      ]);
    });

    it('needs a price in the charged currency in each region', () => {
      const cadOnly = catalogWith(proton, ['plans', 2, 'prices', 0, 'currency'], 'EUR');
      expect(messages(cadOnly)).toEqual([
        'data/providers/proton.yaml plans.2.prices.0.currency: billingCurrency charges USD in GLOBAL, so this plan needs a GLOBAL price in USD',
      ]);
    });

    it('needs real currencies, reported once', () => {
      expect(messagesWith(netflix, ['billingCurrency', 'US'], 'USS')).toEqual([
        'data/providers/netflix.yaml billingCurrency.US: "USS" isn\'t a real ISO 4217 currency code',
      ]);
    });

    it('is optional', () => {
      expect(messagesWith(crave, ['billingCurrency'], undefined)).toEqual([]);
    });
  });

  describe('acceptedNetworks', () => {
    const canada = {
      networks: ['visa', 'mastercard', 'amex'],
      // The test catalog's streaming providers are on example.com.
      url: 'https://help.example.com/payment-methods',
      quotes: ['Visa', 'MasterCard', 'American Express'],
    };

    it('takes a page of the provider’s own sites for each region, GLOBAL and groups too', () => {
      const regions = catalogWith(netflix, ['acceptedNetworks'], {
        CA: canada,
        EU: canada,
        GLOBAL: canada,
      });
      expect(messages(regions)).toEqual([]);
    });

    it('needs real regions, and the provider’s own page', () => {
      expect(messagesWith(netflix, ['acceptedNetworks'], { XX: canada })).toEqual([
        `data/providers/netflix.yaml acceptedNetworks.XX: "XX" isn't an ISO 3166-1 alpha-2 region code (CA, US, GB), a group (EU) or GLOBAL`,
      ]);
      const elsewhere = {
        ...canada,
        url: 'https://www.paypal.com/ca/webapps/mpp/accept-payments-online',
      };
      expect(messagesWith(netflix, ['acceptedNetworks'], { CA: elsewhere })).toEqual([
        "data/providers/netflix.yaml acceptedNetworks.CA.url: Must be a page of Netflix's own sites, on example.com: only the cards it says it takes are listed",
      ]);
    });

    it('is optional', () => {
      expect(messagesWith(netflix, ['acceptedNetworks'], undefined)).toEqual([]);
    });
  });

  describe('regions', () => {
    it('needs a real ISO 3166-1 code, and says the United Kingdom is GB', () => {
      // Only the region's own error: billingCurrency isn't also asked to list "UK".
      expect(messagesWith(netflix, ['plans', 0, 'prices', 1, 'region'], 'UK')).toEqual([
        'data/providers/netflix.yaml plans.0.prices.1.region: "UK" isn\'t an ISO 3166-1 region code: use GB for the United Kingdom',
      ]);
    });

    it('checks bundle prices and billingCurrency too', () => {
      const unknown = `isn't an ISO 3166-1 alpha-2 region code (CA, US, GB), a group (EU) or GLOBAL`;
      // A price can name a province or state (M11.17), so its message says so.
      expect(messagesWith(bundleFile, ['prices', 0, 'region'], 'XX')).toEqual([
        `data/bundles/netflix-crave.yaml prices.0.region: "XX" isn't an ISO 3166-1 alpha-2 region code (CA, US, GB), a province or state (CA-QC), a group (EU) or GLOBAL`,
      ]);
      expect(messagesWith(netflix, ['billingCurrency', 'XX'], 'USD')).toEqual([
        `data/providers/netflix.yaml billingCurrency.XX: "XX" ${unknown}`,
      ]);
    });

    it('accepts a group such as EU', () => {
      const eu = edited(
        catalogWith(netflix, ['plans', 2, 'prices', 0], {
          ...(dataOf(catalog(), netflix) as { plans: { prices: object[] }[] }).plans[2].prices[0],
          region: 'EU',
          currency: 'EUR',
        }),
        netflix,
        ['billingCurrency', 'EU'],
        'EUR',
      );
      expect(messages(eu)).toEqual([]);
    });
  });

  describe('availableIn', () => {
    it('accepts the full list of regions a provider sells in', () => {
      expect(messagesWith(netflix, ['availableIn'], ['CA', 'US', 'MX'])).toEqual([]);
    });

    it('needs every region a plan or add-on is priced in, reported once per file', () => {
      expect(messagesWith(netflix, ['availableIn'], ['CA'])).toEqual([
        'data/providers/netflix.yaml plans.0.prices.1.region: availableIn has no US, but this plan is priced there: add US to it',
      ]);
    });

    it('covers members through their group, and a group through a member', () => {
      const priced = (region: string, currency: string) =>
        edited(
          catalogWith(mullvad, ['plans', 0, 'prices', 1], {
            region,
            currency,
            amount: 60,
            interval: 'year',
            intervalCount: 1,
            autoRenew: false,
            lastVerified: '2026-10-20',
          }),
          mullvad,
          ['billingCurrency'],
          undefined,
        );
      expect(messages(edited(priced('DE', 'EUR'), mullvad, ['availableIn'], ['EU']))).toEqual([]);
      expect(messages(edited(priced('EU', 'EUR'), mullvad, ['availableIn'], ['DE']))).toEqual([]);
      expect(messages(edited(priced('EU', 'EUR'), mullvad, ['availableIn'], ['CA']))).toEqual([
        'data/providers/mullvad.yaml plans.0.prices.1.region: availableIn has no EU, but this plan is priced there: add EU to it',
      ]);
    });

    it('rejects GLOBAL and codes that aren’t regions', () => {
      expect(messagesWith(mullvad, ['availableIn'], ['GLOBAL', 'UK'])).toEqual([
        'data/providers/mullvad.yaml availableIn.0: GLOBAL means everywhere: list regions here, or leave availableIn out',
        'data/providers/mullvad.yaml availableIn.1: "UK" isn\'t an ISO 3166-1 region code: use GB for the United Kingdom',
      ]);
    });
  });

  describe('prices', () => {
    const craveMonthly = () =>
      (dataOf(catalog(), crave) as { plans: { prices: object[] }[] }).plans[0].prices[0];

    it('rejects a repeated price', () => {
      expect(
        messagesWith(crave, ['plans', 0, 'prices', 2], { ...craveMonthly(), amount: 12.99 }),
      ).toEqual([
        'data/providers/crave.yaml plans.0.prices.2: Same region, currency, interval and intervalCount as prices.0: keep one',
      ]);
    });

    it('accepts the same price for another intervalCount', () => {
      expect(
        messagesWith(crave, ['plans', 0, 'prices', 2], { ...craveMonthly(), intervalCount: 3 }),
      ).toEqual([]);
    });

    it('rejects a repeated bundle price', () => {
      const prices = (dataOf(catalog(), bundleFile) as { prices: object[] }).prices;
      expect(messagesWith(bundleFile, ['prices', 1], prices[0])).toEqual([
        'data/bundles/netflix-crave.yaml prices.1: Same region, currency, interval and intervalCount as prices.0: keep one',
      ]);
    });

    it('needs real currencies', () => {
      expect(messagesWith(proton, ['plans', 1, 'prices', 3, 'currency'], 'XYZ')).toEqual([
        'data/providers/proton.yaml plans.1.prices.3.currency: "XYZ" isn\'t a real ISO 4217 currency code',
      ]);
    });

    it('rejects a lastVerified after today', () => {
      expect(
        messagesWith(netflix, ['addOns', 0, 'prices', 0, 'lastVerified'], '2026-10-24'),
      ).toEqual([
        'data/providers/netflix.yaml addOns.0.prices.0.lastVerified: 2026-10-24 is after today (2026-10-23): use the date the price was checked',
      ]);
    });

    it('warns once per file about prices last verified more than 90 days ago', () => {
      // Every fixture price was verified on 2026-10-20, 90 days before 2027-01-18.
      expect(messages(catalog(), '2027-01-18')).toEqual([]);
      expect(messages(catalog(), '2027-01-19').filter((line) => line.includes(mullvad))).toEqual([
        'warning: data/providers/mullvad.yaml plans.0.prices.0.lastVerified: 2 of 2 prices were last verified more than 90 days ago, the oldest on 2026-10-20. Check them again and update lastVerified',
      ]);
      expect(messages(catalog(), '2027-01-19')).toHaveLength(5);
    });

    it('points the warning at the oldest price', () => {
      expect(messagesWith(proton, ['plans', 2, 'prices', 1, 'lastVerified'], '2026-06-01')).toEqual(
        [
          'warning: data/providers/proton.yaml plans.2.prices.1.lastVerified: 1 of 8 prices was last verified more than 90 days ago, on 2026-06-01. Check it again and update lastVerified',
        ],
      );
    });
  });
});

describe('validateCatalog: the discovery queue', () => {
  const queueFile = 'data/queue.yaml';
  const queued = (id: string, website: string, more: object = {}) => ({
    id,
    name: id,
    website,
    category: 'streaming',
    source: 'wikidata',
    status: 'queued',
    ...more,
  });
  const withQueue = (entries: unknown[]) => withFile(catalog(), { file: queueFile, data: entries });

  it('accepts a queue that agrees with the catalog', () => {
    expect(
      messages(
        withQueue([
          queued('netflix', 'https://www.netflix.com', { source: 'own', status: 'done' }),
          queued('spotify', 'https://www.spotify.com'),
          queued('vk', 'https://vk.ru', { status: 'out-of-scope', note: 'A social network' }),
        ]),
      ),
    ).toEqual([]);
  });

  it("reports the queue's schema problems", () => {
    expect(
      messages(withQueue([queued('spotify', 'https://www.spotify.com', { status: 'rejected' })])),
    ).toEqual([
      "data/queue.yaml 0.status: Say why it's rejected in a note, so nobody adds it again",
    ]);
  });

  it('wants a real service category', () => {
    expect(
      messages(withQueue([queued('spotify', 'https://www.spotify.com', { category: 'musik' })])),
    ).toEqual([
      expect.stringMatching(
        /^data\/queue\.yaml 0\.category: "musik" isn't a service category in data\/categories\.yaml/,
      ),
    ]);
  });

  it('wants done entries to have a provider file, and providers to be done', () => {
    expect(
      messages(
        withQueue([
          queued('spotify', 'https://www.spotify.com', { status: 'done' }),
          queued('netflix', 'https://www.netflix.com'),
        ]),
      ),
    ).toEqual([
      `data/queue.yaml 0.status: "spotify" is done, but there's no data/providers/spotify.yaml: add it, or give another status with a note`,
      'data/queue.yaml 1.status: "netflix" is in the catalog (data/providers/netflix.yaml): mark it done',
    ]);
  });

  it("refuses a queued service on a catalog provider's site", () => {
    expect(messages(withQueue([queued('proton-mail', 'https://proton.me/mail')]))).toEqual([
      "data/queue.yaml 0.website: It's on proton's site, which is in the catalog: remove the entry, or give it a status with a note",
    ]);
  });
});

describe('formatCatalogIssue', () => {
  const issue = {
    severity: 'error' as const,
    file: 'data/providers/netflix.yaml',
    path: ['plans', 2, 'features', 'video.quality'],
    message: 'Use true or false',
  };

  it('puts the line after the file name', () => {
    expect(formatCatalogIssue(issue, 42)).toBe(
      'data/providers/netflix.yaml:42 plans.2.features.video.quality: Use true or false',
    );
  });

  it('formats an issue about the whole file', () => {
    expect(formatCatalogIssue({ ...issue, path: [] })).toBe(
      'data/providers/netflix.yaml: Use true or false',
    );
    expect(formatCatalogIssue({ ...issue, path: [] }, 3)).toBe(
      'data/providers/netflix.yaml:3: Use true or false',
    );
  });
});
