import { monthOf, type IsoMonth } from '../dates/iso-month';
import type { IsoDate } from '../dates/iso-date';
import type { QueryParams } from '../search/search-params';

// The Calendar's URL (PROJECT-PLAN P10, §3.5, M7.4): ?month=2026-10&lists=<id>,<id>&view=year. The month shown, the
// lists it shows when they're not all of them, and the year view (M10.4), which shows the month's year and goes back to
// that month. Without `lists`, the lists Settings remembers this device showing last (its calendarHiddenLists left
// out), so a list made since shows too.

/** What the Calendar shows. */
export interface CalendarQuery {
  month: IsoMonth;
  /** The lists shown, in the order the user's lists are; all of them when it's every list. */
  lists: string[];
  /** The year view (M10.4): twelve months of `month`'s year. Left out, the month's. */
  view?: 'year';
}

/** The Calendar's query parameters. */
export type CalendarParams = Partial<Record<'month' | 'lists' | 'view', string>>;

/**
 * The Calendar's state in `params`: a month that's one (else today's), and the lists the URL names that are the user's
 * (`listIds`, in their order), else every list but the `hidden` ones Settings remembers. `rewrite` says the URL had
 * something else in it, which the page replaces in place.
 */
export function readCalendarParams(
  params: QueryParams,
  today: IsoDate,
  listIds: readonly string[],
  hidden: readonly string[] = [],
): { query: CalendarQuery; rewrite: boolean } {
  const first = (name: string) => {
    const value = params[name];
    return typeof value === 'string' ? value : value?.[0];
  };
  let rewrite = Object.keys(params).some(
    (name) => name !== 'month' && name !== 'lists' && name !== 'view',
  );
  const monthParam = first('month');
  const month = monthParam !== undefined && isMonth(monthParam) ? monthParam : monthOf(today);
  if (monthParam !== undefined && month !== monthParam) rewrite = true;
  // The month view is the Calendar without `view`.
  const viewParam = first('view');
  if (viewParam !== undefined && viewParam !== 'year') rewrite = true;

  const listsParam = first('lists');
  let lists: string[];
  if (listsParam === undefined) {
    lists = listIds.filter((id) => !hidden.includes(id));
  } else {
    const named = new Set(listsParam.split(',').filter((id) => id !== ''));
    lists = listIds.filter((id) => named.has(id));
    // A list that's gone, or one named twice, or none at all: the URL says it differently.
    if (lists.length !== named.size || lists.length === 0) {
      rewrite = true;
      if (lists.length === 0) lists = listIds.filter((id) => !hidden.includes(id));
    }
    if (lists.length === listIds.length) rewrite = true;
  }
  return { query: { month, lists, ...(viewParam === 'year' && { view: 'year' }) }, rewrite };
}

/** The query parameters for `query`: `lists` only when it isn't every list, `view` only for the year's. */
export function writeCalendarParams(
  query: CalendarQuery,
  listIds: readonly string[],
): CalendarParams {
  const all = listIds.every((id) => query.lists.includes(id));
  return {
    month: query.month,
    ...(!all && { lists: query.lists.join(',') }),
    ...(query.view === 'year' && { view: 'year' }),
  };
}

/** The lists Settings remembers this device leaving out (calendarHiddenLists): every list not shown. */
export function hiddenLists(shown: readonly string[], listIds: readonly string[]): string[] {
  return listIds.filter((id) => !shown.includes(id));
}

function isMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}
