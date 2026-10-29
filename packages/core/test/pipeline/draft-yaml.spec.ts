import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import crave from '../../../../data/providers/crave.yaml?raw';
import disneyPlus from '../../../../data/providers/disney-plus.yaml?raw';
import mullvad from '../../../../data/providers/mullvad.yaml?raw';
import netflix from '../../../../data/providers/netflix.yaml?raw';
import proton from '../../../../data/providers/proton.yaml?raw';
import { draftYaml } from '../../src';

/** Prettier as the repository runs it (.prettierrc). */
const prettier = (text: string) =>
  format(text, { parser: 'yaml', printWidth: 100, singleQuote: true });

describe('draftYaml', () => {
  it.each([
    ['netflix', netflix],
    ['mullvad', mullvad],
    ['proton', proton],
    ['disney-plus', disneyPlus],
    ['crave', crave],
  ])('writes %s so it reads back the same and Prettier leaves it alone', async (_, text) => {
    const value = parse(text) as Record<string, unknown>;
    const written = draftYaml(value, {
      header: ['Drafted by the discovery pipeline.', 'Pricing: https://example.com/pricing.'],
      above: { plans: ['Prices read today.'] },
    });
    expect(parse(written)).toEqual(value);
    expect(await prettier(written)).toBe(written);
  });

  it('quotes what YAML would read as something else, as Prettier does', async () => {
    const value = {
      id: 'example',
      name: 'Yes',
      notes: "It's 50% off: for now # really",
      perks: ['Free', 'a, b', 'Proton Scribe writing assistant'],
      prices: [{ amount: 9.99, quote: '"Billed yearly"', lastVerified: '2026-10-28', count: '12' }],
    };
    const written = draftYaml(value);
    expect(written).toBe(
      [
        'id: example',
        "name: 'Yes'",
        'notes: "It\'s 50% off: for now # really"',
        "perks: [Free, 'a, b', Proton Scribe writing assistant]",
        '',
        'prices:',
        '  - amount: 9.99',
        '    quote: \'"Billed yearly"\'',
        '    lastVerified: 2026-10-28',
        "    count: '12'",
        '',
      ].join('\n'),
    );
    expect(parse(written)).toEqual(value);
    expect(await prettier(written)).toBe(written);
  });
});
