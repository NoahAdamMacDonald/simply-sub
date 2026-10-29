import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import automationYaml from '../../../../data/automation.yaml?raw';
import {
  automationSchema,
  cadenceDays,
  digestDue,
  isDue,
  searchBudgets,
  type Automation,
} from '../../src';
import { issues } from '../catalog/helpers';

const automation = automationSchema.parse(parse(automationYaml)) as Automation;

describe('automationSchema', () => {
  it('reads data/automation.yaml', () => {
    expect(automation.reviewer).toBe('scheduled-claude');
    expect(automation.cadence.pricing).toBe('daily');
  });

  it('wants a budget for Tavily and Brave in both places, and each engine once', () => {
    const value = {
      ...automation,
      search: [
        { engine: 'brave', bot: 450 },
        { engine: 'tavily', bot: 500, local: 500 },
        { engine: 'tavily', bot: 1, local: 1 },
      ],
    };
    expect(issues(automationSchema, value)).toEqual([
      'search.2.engine: "tavily" is listed more than once',
      'search.0.local: Give brave a monthly local budget: only your own SearXNG may have none',
    ]);
  });

  it('refuses an unknown cadence or reviewer', () => {
    expect(
      issues(automationSchema, {
        ...automation,
        cadence: { ...automation.cadence, pricing: 'hourly' },
        reviewer: 'robot',
      }),
    ).toHaveLength(2);
  });
});

describe('cadences', () => {
  it('knows how many days apart each runs', () => {
    expect([
      cadenceDays('daily'),
      cadenceDays('weekly'),
      cadenceDays('monthly'),
      cadenceDays('off'),
    ]).toEqual([1, 7, 30, undefined]);
  });

  it('is due when never done, or when its days have passed', () => {
    expect(isDue('weekly', undefined, '2026-10-28')).toBe(true);
    expect(isDue('weekly', '2026-10-22', '2026-10-28')).toBe(false);
    expect(isDue('weekly', '2026-10-21', '2026-10-28')).toBe(true);
    expect(isDue('daily', '2026-10-27', '2026-10-28')).toBe(true);
    expect(isDue('off', undefined, '2026-10-28')).toBe(false);
  });
});

describe('digestDue', () => {
  it('is due on its weekday, once', () => {
    // 2026-11-02 is a Monday.
    expect(digestDue(automation, '2026-11-02', '2026-10-26')).toBe(true);
    expect(digestDue(automation, '2026-11-02', '2026-11-02')).toBe(false);
    expect(digestDue(automation, '2026-11-03', '2026-10-26')).toBe(false);
  });
});

describe('searchBudgets', () => {
  it('gives each place its share, and SearXNG none', () => {
    expect(searchBudgets(automation, 'bot')).toEqual([
      { engine: 'tavily', monthly: 500 },
      { engine: 'brave', monthly: 450 },
      { engine: 'searxng' },
    ]);
  });
});
