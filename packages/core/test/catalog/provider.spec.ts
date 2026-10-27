import { describe, expect, it } from 'vitest';
import { providerSchema } from '../../src';
import { provider } from './fixtures';
import { issues, withValue } from './helpers';

describe('providerSchema', () => {
  it('accepts a valid provider and returns it unchanged', () => {
    expect(providerSchema.parse(provider)).toEqual(provider);
  });

  it('accepts a provider without the optional fields', () => {
    const minimal = {
      id: 'mullvad',
      name: 'Mullvad VPN',
      website: 'https://mullvad.net',
      category: 'vpn',
      spendCategory: 'software',
      cancelUrl: 'https://mullvad.net/en/help/refunds',
      plans: [
        {
          id: 'mullvad.vpn',
          name: 'Mullvad VPN',
          link: 'https://mullvad.net/en/pricing',
          features: {},
          prices: [
            {
              region: 'GLOBAL',
              currency: 'EUR',
              amount: 5,
              interval: 'month',
              intervalCount: 1,
              autoRenew: false,
              lastVerified: '2026-10-10',
            },
          ],
        },
      ],
    };
    expect(issues(providerSchema, minimal)).toEqual([]);
  });

  it('accepts a free plan, whose price is 0', () => {
    const free = withValue(provider, ['plans', 0, 'prices', 0, 'amount'], 0);
    expect(issues(providerSchema, free)).toEqual([]);
  });

  describe('a price that includes tax', () => {
    const path = ['plans', 0, 'prices', 0, 'taxIncluded'];

    it('is accepted with the source page’s words', () => {
      const included = withValue(provider, path, { quote: 'Including VAT.' });
      expect(issues(providerSchema, included)).toEqual([]);
    });

    it.each([
      [true, 'Invalid input: expected object, received boolean'],
      [{}, 'Invalid input: expected string, received undefined'],
      [{ quote: ' ' }, 'Must not be empty'],
    ])('needs the words that say so: %j is rejected', (value, message) => {
      const [issue] = issues(providerSchema, withValue(provider, path, value));
      expect(issue).toMatch(/^plans\.0\.prices\.0\.taxIncluded/);
      expect(issue).toContain(message);
    });
  });

  describe('unknown keys', () => {
    it.each([
      ['on the provider', ['cancelURL'], ': Unrecognized key: "cancelURL"'],
      ['on a plan', ['plans', 1, 'addOns'], 'plans.1: Unrecognized key: "addOns"'],
      [
        'on a price',
        ['plans', 0, 'prices', 1, 'sourceURL'],
        'plans.0.prices.1: Unrecognized key: "sourceURL"',
      ],
      ['in sources', ['sources', 'cancel'], 'sources: Unrecognized key: "cancel"'],
      ['on an add-on', ['addOns', 0, 'notes'], 'addOns.0: Unrecognized key: "notes"'],
    ])('are rejected %s', (_where, path, expected) => {
      expect(issues(providerSchema, withValue(provider, path, 'x'))).toEqual([expected]);
    });
  });

  describe('wrong types', () => {
    it.each([
      [
        ['plans', 0, 'prices', 0, 'amount'],
        '7.99',
        'Invalid input: expected number, received string',
      ],
      [
        ['plans', 0, 'prices', 0, 'autoRenew'],
        'yes',
        'Invalid input: expected boolean, received string',
      ],
      [
        ['plans', 0, 'prices', 0, 'intervalCount'],
        1.5,
        'Invalid input: expected int, received number',
      ],
      [
        ['plans', 0, 'features'],
        ['video.quality'],
        'Invalid input: expected record, received array',
      ],
      [['plans'], { id: 'netflix.standard' }, 'Invalid input: expected array, received object'],
      [['aliases'], 'netflix', 'Invalid input: expected array, received string'],
    ])('%j = %j is rejected', (path, value, message) => {
      expect(issues(providerSchema, withValue(provider, path, value))).toEqual([
        `${path.join('.')}: ${message}`,
      ]);
    });
  });

  describe('formats', () => {
    it.each([
      [
        ['id'],
        'Netflix',
        'Use a kebab-case id: lowercase letters and digits, joined by single hyphens (disney-plus)',
      ],
      [['website'], 'http://www.netflix.com', 'Use a full https:// URL'],
      [['plans', 0, 'link'], 'netflix.com/signup', 'Use a full https:// URL'],
      [
        ['plans', 0, 'prices', 0, 'region'],
        'CAN',
        'Use a two-letter ISO 3166-1 region in capitals (CA, US) or GLOBAL',
      ],
      [
        ['plans', 0, 'prices', 0, 'currency'],
        'cad',
        'Use a three-letter ISO 4217 currency code in capitals (CAD)',
      ],
      [
        ['plans', 0, 'prices', 0, 'lastVerified'],
        '2026-10-32',
        'Use a real date written YYYY-MM-DD',
      ],
      [
        ['plans', 0, 'prices', 0, 'interval'],
        'monthly',
        'Invalid option: expected one of "day"|"week"|"month"|"year"',
      ],
      [['plans', 0, 'prices', 0, 'amount'], -7.99, 'Must be 0 or more'],
      [['plans', 0, 'prices', 0, 'intervalCount'], 0, 'Must be a whole number of at least 1'],
      [['plans', 1, 'addOnLimit'], 0, 'Must be a whole number of at least 1'],
      [['plans', 0, 'prices'], [], 'List at least one price'],
      [['plans'], [], 'List at least one plan'],
      [
        ['acceptedNetworks', 1],
        'diners',
        'Invalid option: expected one of "visa"|"mastercard"|"amex"|"discover"|"interac"|"unionpay"|"jcb"|"other"',
      ],
      [['acceptedNetworks'], [], 'Leave acceptedNetworks out when they are unknown'],
      [['availableIn'], [], 'Leave availableIn out when the regions are unknown'],
      [
        ['billingCurrency', 'CA'],
        'cad',
        'Use a three-letter ISO 4217 currency code in capitals (CAD)',
      ],
      [
        ['plans', 0, 'features', 'video.quality'],
        '4K',
        'Use a kebab-case id: lowercase letters and digits, joined by single hyphens (disney-plus)',
      ],
      [
        ['plans', 0, 'features', 'video.quality'],
        { id: '4k' },
        'Use true or false, a number, unlimited, a value id, or a list of value ids',
      ],
      [['plans', 1, 'featureLabels', 'video.quality=4K'], 'Ultra HD', 'Invalid key in record'],
      [['notes'], '', 'Must not be empty'],
    ])('%j = %j is rejected', (path, value, message) => {
      expect(issues(providerSchema, withValue(provider, path, value))).toEqual([
        `${path.join('.')}: ${message}`,
      ]);
    });

    it('rejects a region key in billingCurrency', () => {
      expect(issues(providerSchema, withValue(provider, ['billingCurrency', 'ca'], 'CAD'))).toEqual(
        ['billingCurrency.ca: Invalid key in record'],
      );
    });
  });

  describe('checks inside the file', () => {
    it('requires plan and add-on ids to start with the provider id', () => {
      const moved = withValue(
        withValue(provider, ['plans', 1, 'id'], 'hulu.premium'),
        ['addOns', 0, 'id'],
        'hulu.extra',
      );
      expect(issues(providerSchema, moved)).toEqual([
        'plans.1.id: Must start with "netflix."',
        'addOns.0.id: Must start with "netflix."',
      ]);
    });

    it('rejects a plan id that is used twice', () => {
      expect(
        issues(providerSchema, withValue(provider, ['plans', 1, 'id'], 'netflix.standard-ads')),
      ).toEqual(['plans.1.id: "netflix.standard-ads" is listed more than once']);
    });

    it('rejects an add-on id that is also a plan id', () => {
      expect(
        issues(providerSchema, withValue(provider, ['addOns', 0, 'id'], 'netflix.premium')),
      ).toEqual(['addOns.0.id: "netflix.premium" is listed more than once']);
    });

    it('rejects an add-on listed twice on a plan', () => {
      const twice = withValue(
        provider,
        ['plans', 1, 'addOnIds'],
        ['netflix.extra-member', 'netflix.extra-member'],
      );
      expect(issues(providerSchema, twice)).toEqual([
        'plans.1.addOnIds.1: "netflix.extra-member" is listed more than once',
      ]);
    });

    it('rejects a region in availableIn that isn’t written as one', () => {
      expect(issues(providerSchema, withValue(provider, ['availableIn'], ['CA', 'us']))).toEqual([
        'availableIn.1: Use a two-letter ISO 3166-1 region in capitals (CA, US) or GLOBAL',
      ]);
    });

    it('rejects a region listed twice in availableIn', () => {
      expect(
        issues(providerSchema, withValue(provider, ['availableIn'], ['CA', 'US', 'CA'])),
      ).toEqual(['availableIn.2: "CA" is listed more than once']);
    });

    it('rejects addOnLimit without addOnIds', () => {
      expect(
        issues(providerSchema, withValue(provider, ['plans', 1, 'addOnIds'], undefined)),
      ).toEqual(['plans.1.addOnLimit: addOnLimit needs addOnIds']);
    });
  });
});
