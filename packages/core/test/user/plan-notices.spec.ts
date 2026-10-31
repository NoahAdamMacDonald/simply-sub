import { describe, expect, it } from 'vitest';
import {
  planNoticeText,
  planNoticesBetween,
  resolveItem,
  withPlanNotices,
  type CatalogData,
  type PlanNotice,
} from '../../src';
import { catalog, fx, item, today } from '../optimizer/fixtures';

// A renamed plan keeps its id (M10.27): Home tells the users who have it, once, and its cards show the old name for six
// months.

/** The catalog with Netflix Standard renamed Essentials on `until`. */
function renamed(until = '2026-10-27'): CatalogData {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) =>
        plan.id === 'netflix.standard'
          ? { ...plan, name: 'Essentials', formerNames: [{ name: plan.name, until }] }
          : plan,
      ),
    })),
  };
}

describe('planNoticesBetween', () => {
  it('tells the users of a renamed plan its new name, once', () => {
    const notices = planNoticesBetween(
      [item('netflix.standard'), item('netflix.standard'), item('crave.premium')],
      catalog,
      renamed(),
      today,
    );
    expect(notices).toEqual([
      {
        kind: 'renamed',
        planId: 'netflix.standard',
        title: 'Netflix Standard',
        name: 'Essentials',
        date: today,
      },
    ]);
    expect(planNoticeText(notices[0], (date) => date)).toBe(
      'Netflix Standard is now called Essentials',
    );
    // The next update, with the rename already in: nothing new.
    expect(planNoticesBetween([item('netflix.standard')], renamed(), renamed(), today)).toEqual([]);
  });

  it('says nothing to a user without the plan, or for a deleted item', () => {
    const gone = { ...item('netflix.standard'), deletedAt: '2026-10-20T09:15:00.000Z' };
    expect(planNoticesBetween([item('crave.premium'), gone], catalog, renamed(), today)).toEqual(
      [],
    );
  });
});

describe('withPlanNotices', () => {
  const notice = (planId: string, date: string): PlanNotice => ({
    kind: 'renamed',
    planId,
    title: planId,
    name: 'New',
    date,
  });

  it('puts the new ones first and drops what’s a month old', () => {
    const merged = withPlanNotices(
      [notice('crave.premium', '2026-10-20'), notice('netflix.premium', '2026-09-01')],
      [notice('netflix.standard', today)],
      today,
    );
    expect(merged.map((entry) => entry.planId)).toEqual(['netflix.standard', 'crave.premium']);
  });
});

describe('resolveItem and a renamed plan', () => {
  const context = {
    customSubs: new Map(),
    country: 'CA',
    currency: 'CAD',
    fx,
    profileRanks: new Map(),
  };

  it('keeps the item, with its new name and its old one for six months', () => {
    const result = resolveItem(item('netflix.standard'), {
      ...context,
      catalog: renamed(),
      today,
    });
    expect(result.ok && [result.resolved.planName, result.resolved.formerName]).toEqual([
      'Essentials',
      'Standard',
    ]);
    const later = resolveItem(item('netflix.standard'), {
      ...context,
      catalog: renamed(),
      today: '2027-04-28',
    });
    expect(later.ok && later.resolved.formerName).toBeUndefined();
  });
});
