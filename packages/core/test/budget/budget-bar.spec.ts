import { describe, expect, it } from 'vitest';
import { budgetBar } from '../../src';

describe('budgetBar', () => {
  it.each([
    { what: 'half the budget', value: 100, max: 200, level: 'ok', fill: 0.5, percent: 50 },
    { what: 'nothing spent', value: 0, max: 200, level: 'ok', fill: 0, percent: 0 },
    { what: 'just under 75%', value: 149.99, max: 200, level: 'ok', fill: 0.74995, percent: 74 },
    { what: 'exactly 75%', value: 150, max: 200, level: 'warn', fill: 0.75, percent: 75 },
    { what: 'exactly the budget', value: 200, max: 200, level: 'warn', fill: 1, percent: 100 },
    {
      what: 'just under the budget',
      value: 199.2,
      max: 200,
      level: 'warn',
      fill: 0.996,
      percent: 99,
    },
    {
      what: 'a cent over the budget',
      value: 200.8,
      max: 200,
      level: 'over',
      fill: 1,
      percent: 101,
    },
    { what: 'over the budget', value: 224, max: 200, level: 'over', fill: 1, percent: 112 },
  ])('$what: $percent%, $level', ({ value, max, level, fill, percent }) => {
    const bar = budgetBar(value, max);
    expect(bar).toMatchObject({ level, percent });
    expect(bar.fill).toBeCloseTo(fill, 10);
    expect(bar).not.toHaveProperty('markerAt');
  });

  it("isn't thrown off by floating point", () => {
    // 29 / 100 * 100 is 28.999999999999996.
    expect(budgetBar(29, 100).percent).toBe(29);
    expect(budgetBar(0.1 + 0.2, 0.3)).toEqual({
      level: 'warn',
      fill: 1,
      percent: 100,
      towardYellow: 1,
      towardRed: 0,
    });
  });

  it('gives an empty bar for a max of 0', () => {
    expect(budgetBar(0, 0)).toEqual({
      level: 'ok',
      fill: 0,
      percent: 0,
      towardYellow: 0,
      towardRed: 0,
    });
  });

  it('colours the fill gradually: green to yellow at the budget, then to red at half again over it (M7.7)', () => {
    const scale = (value: number) => {
      const { towardYellow, towardRed } = budgetBar(value, 200);
      return [towardYellow, towardRed];
    };
    expect(scale(0)).toEqual([0, 0]);
    expect(scale(50)).toEqual([0.25, 0]);
    // Exactly at the budget: yellow.
    expect(scale(200)).toEqual([1, 0]);
    expect(scale(250)).toEqual([1, 0.5]);
    expect(scale(300)).toEqual([1, 1]);
    expect(scale(600)).toEqual([1, 1]);
  });

  describe('with a marker (the Calendar: paid so far of the month, and the monthly budget)', () => {
    it("colours the bar by the month's total against the budget, not by what's paid so far", () => {
      // $10 of $66.45 paid, against a $60 budget: the month goes over.
      expect(budgetBar(10, 66.45, 60)).toMatchObject({ level: 'over', percent: 15 });
      // $44.45 of $66.45 paid, against a $200 budget: about a third of it.
      expect(budgetBar(44.45, 66.45, 200)).toMatchObject({ level: 'ok', percent: 66 });
      expect(budgetBar(0, 160, 200).level).toBe('warn');
      // Its one colour too (M7.7): $80 against $60 is a third over, most of the way from yellow to red; $50 against
      // $60 most of the way from green to yellow.
      expect(budgetBar(10, 80, 60)).toMatchObject({ towardYellow: 1, towardRed: 0.6667 });
      expect(budgetBar(10, 50, 60)).toMatchObject({ towardYellow: 0.8333, towardRed: 0 });
    });

    it('places the tick on the bar', () => {
      expect(budgetBar(10, 80, 60).markerAt).toBe(0.75);
      expect(budgetBar(10, 60, 60).markerAt).toBe(1);
    });

    it('leaves the tick out when the budget is past the end of the bar', () => {
      expect(budgetBar(10, 50, 60)).not.toHaveProperty('markerAt');
    });

    it('gives an empty bar and no tick for a month with no payments', () => {
      expect(budgetBar(0, 0, 60)).toEqual({
        level: 'ok',
        fill: 0,
        percent: 0,
        towardYellow: 0,
        towardRed: 0,
      });
    });
  });
});
