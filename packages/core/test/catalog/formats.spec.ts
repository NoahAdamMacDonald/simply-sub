import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import {
  bundleIdSchema,
  currencySchema,
  dottedSlugSchema,
  httpsUrlSchema,
  iconNameSchema,
  isoDateSchema,
  planIdSchema,
  rankKeySchema,
  regionSchema,
  slugSchema,
  textSchema,
  tierIdSchema,
} from '../../src';
import { issues } from './helpers';

const cases: [name: string, schema: z.ZodType, valid: unknown[], invalid: unknown[]][] = [
  [
    'slug',
    slugSchema,
    ['netflix', 'disney-plus', '480p', '4k'],
    ['Netflix', 'disney_plus', 'disney--plus', '-plus', 'netflix.standard', '', 1],
  ],
  [
    'dotted slug',
    dottedSlugSchema,
    ['includes-subscription', 'video.quality', 'password-manager.item-types'],
    ['video..quality', '.video', 'video.', 'Video.Quality'],
  ],
  [
    'plan id',
    planIdSchema,
    ['netflix.standard', 'ubisoft-plus.classics'],
    ['netflix', 'netflix.', 'Netflix.standard'],
  ],
  [
    'bundle id',
    bundleIdSchema,
    ['bundle.disney-crave-premium'],
    ['disney-crave-premium', 'bundle.', 'bundle.a.b'],
  ],
  ['tier id', tierIdSchema, ['1', '2-4', '5+', '1000+'], ['+5', '5++', '2 - 4', 1]],
  [
    'rank key',
    rankKeySchema,
    [
      'streaming.ad-free',
      'video.quality=4k',
      'streaming.concurrent-streams=2-4',
      'streaming.concurrent-streams=5+',
      'password-manager.item-types=passkey',
    ],
    ['video.quality=', '=4k', 'video.quality=4k=hd', 'video.quality=4K'],
  ],
  ['region', regionSchema, ['CA', 'US', 'GLOBAL'], ['ca', 'CAN', 'Global', 'C']],
  ['currency', currencySchema, ['CAD', 'EUR'], ['cad', 'CA', 'CADD', '$']],
  [
    'ISO date',
    isoDateSchema,
    ['2026-10-21', '2028-02-29'],
    ['2026-10-32', '2026-02-29', '2026/10/21', '21-10-2026', '2026-1-5', 20261021],
  ],
  [
    'https URL',
    httpsUrlSchema,
    ['https://www.netflix.com', 'https://help.netflix.com/en/node/24926'],
    [
      'http://www.netflix.com',
      'www.netflix.com',
      'https://localhost',
      'mailto:help@netflix.com',
      'javascript:alert(1)',
    ],
  ],
  ['icon name', iconNameSchema, ['live_tv', 'vpn_lock'], ['Live TV', 'live-tv']],
  ['text', textSchema, ['Netflix'], ['', '   ', 1]],
];

describe.each(cases)('%s', (_name, schema, valid, invalid) => {
  it.each(valid)('accepts %j', (value) => {
    expect(issues(schema, value)).toEqual([]);
  });

  it.each(invalid)('rejects %j', (value) => {
    expect(issues(schema, value)).not.toEqual([]);
  });
});

describe('format messages', () => {
  it('explain the expected format instead of showing the regex', () => {
    expect(issues(currencySchema, 'cad')).toEqual([
      ': Use a three-letter ISO 4217 currency code in capitals (CAD)',
    ]);
    expect(issues(isoDateSchema, '2026-10-32')).toEqual([': Use a real date written YYYY-MM-DD']);
    expect(issues(httpsUrlSchema, 'http://www.netflix.com')).toEqual([': Use a full https:// URL']);
  });

  it('are given for a value of the wrong type, such as an unquoted number in YAML', () => {
    expect(issues(tierIdSchema, 1)).toEqual([
      ': Use a tier id such as 1, 2-4 or 5+ (in YAML, quote ids that are plain numbers: "1")',
    ]);
  });

  it("leave Zod's message for a missing key", () => {
    expect(issues(z.strictObject({ id: slugSchema }), {})).toEqual([
      'id: Invalid input: expected string, received undefined',
    ]);
  });
});
