import { describe, expect, it } from 'vitest';
import { providerActivity, readCatalogSource, type ListItem } from '../../src';
import { catalog } from '../catalog/catalog-files';

// The fixture catalog's bundle is Netflix Standard with Crave Premium, sold by Crave.

const { bundles } = readCatalogSource(catalog());
const today = '2026-10-26';
const family = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const work = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';

let count = 0;

function item(
  listId: string,
  source: ListItem['source'],
  dates: { startDate?: string; endDate?: string } = {},
): ListItem {
  count += 1;
  return {
    id: `0192f1c4-7b2e-7c3a-9d41-5e8f2a1b${String(count).padStart(4, '0')}`,
    listId,
    source,
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-09-10',
      autoRenew: true,
      ...dates,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
}

const plan = (planId: string): ListItem['source'] => ({ kind: 'catalog', planId });
const ended = { endDate: '2026-10-01' };

describe('providerActivity', () => {
  it('is active when one of its items is, and counts the lists it’s in', () => {
    const activity = providerActivity(
      [
        item(family, plan('netflix.standard'), ended),
        item(work, plan('netflix.standard-ads')),
        item(work, plan('netflix.standard')),
      ],
      bundles,
      today,
    );

    expect(activity).toEqual(
      new Map([
        [
          'netflix',
          {
            kind: 'active',
            lists: 2,
            // In the order their items came.
            listIds: [family, work],
            plans: [
              { planId: 'netflix.standard', kind: 'active' },
              { planId: 'netflix.standard-ads', kind: 'active' },
            ],
          },
        ],
      ]),
    );
  });

  it('gives an inactive provider the soonest date it starts again', () => {
    const activity = providerActivity(
      [
        item(family, plan('mullvad.vpn'), { startDate: '2027-01-01' }),
        item(family, plan('mullvad.vpn'), { startDate: '2026-12-01' }),
        item(work, plan('mullvad.vpn'), ended),
      ],
      bundles,
      today,
    );

    expect(activity.get('mullvad')).toEqual({
      kind: 'inactive',
      activeFrom: '2026-12-01',
      lists: 2,
      listIds: [family, work],
      plans: [{ planId: 'mullvad.vpn', kind: 'inactive' }],
    });
  });

  it('counts a bundle for each provider whose plan it includes, and custom subscriptions for none', () => {
    const activity = providerActivity(
      [
        item(family, { kind: 'bundle', bundleId: 'bundle.netflix-crave' }),
        item(family, { kind: 'bundle', bundleId: 'bundle.gone' }),
        item(family, {
          kind: 'custom',
          customSubId: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c',
          customPlanId: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d',
        }),
      ],
      bundles,
      today,
    );

    expect([...activity.keys()]).toEqual(['netflix', 'crave']);
    expect(activity.get('crave')).toEqual({
      kind: 'active',
      lists: 1,
      listIds: [family],
      plans: [{ planId: 'crave.premium', kind: 'active' }],
    });
  });
});
