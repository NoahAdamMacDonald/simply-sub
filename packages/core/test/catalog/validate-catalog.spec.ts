import { describe, expect, it } from 'vitest';
import { formatCatalogIssue, validateCatalog, type CatalogSourceFile } from '../../src';
import { catalog, catalogWith, edited, today } from './catalog-files';
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
        'data/notes.yaml: Not a catalog file: use data/features.yaml, data/categories.yaml, data/resellers.yaml, data/providers/<id>.yaml or data/bundles/<slug>.yaml',
      ],
      [
        'data/providers/old/netflix.yaml',
        'data/providers/old/netflix.yaml: Not a catalog file: use data/features.yaml, data/categories.yaml, data/resellers.yaml, data/providers/<id>.yaml or data/bundles/<slug>.yaml',
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
        plans: [
          {
            id: 'bundle.netflix-crave',
            name: 'Netflix and Crave',
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

  describe('regions', () => {
    it('needs a real ISO 3166-1 code, and says the United Kingdom is GB', () => {
      // Only the region's own error: billingCurrency isn't also asked to list "UK".
      expect(messagesWith(netflix, ['plans', 0, 'prices', 1, 'region'], 'UK')).toEqual([
        'data/providers/netflix.yaml plans.0.prices.1.region: "UK" isn\'t an ISO 3166-1 region code: use GB for the United Kingdom',
      ]);
    });

    it('checks bundle prices and billingCurrency too', () => {
      const unknown = `isn't an ISO 3166-1 alpha-2 region code (CA, US, GB), a group (EU) or GLOBAL`;
      expect(messagesWith(bundleFile, ['prices', 0, 'region'], 'XX')).toEqual([
        `data/bundles/netflix-crave.yaml prices.0.region: "XX" ${unknown}`,
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
