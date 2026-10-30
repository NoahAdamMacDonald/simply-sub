import { addDays, type IsoDate } from '../dates/iso-date';
import type { IsoMonth } from '../dates/iso-month';
import { samePeriod } from '../dates/period';
import { itemCharges, type Charge, type Charged } from '../schedule/charges';
import { next12Range } from '../schedule/list-metrics';
import type { Billing } from '../user/list-item';
import { itemTitle } from '../user/item-text';
import type { ResolvedItem } from '../user/resolved';
import type { ExportContext, ExportList } from './export-tables';

// The .ics file (BLUEPRINT §11.2, §11.3, M7.5, M7.12, M10.2): an ongoing subscription is one repeating event for each
// run of charges at the same amount, its repeat rule written from the schedule's own (a plan billed on the 31st falls
// on each month's last day: BYMONTHDAY=-1; an end date is UNTIL), so it goes on past the first year, and a calendar
// shows it as long as it lasts. A price of the user's own that ends, or a plan's end, ends its run. The rules keep to
// what Proton Calendar takes, which drops any other event (repeatRule). Specific dates, add-ons billed on a period of
// their own and a monthly plan billed on the 29th or 30th stay an event per charge in the next 12 months, which no
// such rule writes exactly. The app gives the events to the `ics` package, and the live calendar to POST /cal.

/** How the app writes money and dates: core lays the files out, and the app formats what they say. */
export interface ExportFormat {
  /** "$19.94", "US$9.99". */
  money(amount: number, currency: string): string;
  /** "Nov 12, 2026". */
  date(date: IsoDate): string;
  /** "November 2026" (the Calendar's Text export, M7.9). */
  month(month: IsoMonth): string;
}

/** A day as the `ics` package takes it: [2026, 11, 12]. */
export type CalendarDate = [year: number, month: number, day: number];

/** An all-day event, in the shape the `ics` package takes. */
export interface CalendarEvent {
  /** The same in every export, so a calendar that imports the file again can update the event. */
  uid: string;
  start: CalendarDate;
  /** The next day: an all-day event ends where its day does. */
  end: CalendarDate;
  title: string;
  description: string;
  /** Its item's live tags, by name (M7.9): calendars that show categories show them. */
  categories?: string[];
  /** For a run of charges: its repeat rule (RFC 5545's RRULE, without the name), from the first charge on (M7.12). */
  recurrenceRule?: string;
}

/** The domain each event's UID ends with. */
const uidDomain = 'sub.simplely.ca';

/**
 * How the events are written. The download's amounts are in the user's currency, ≈ when converted; the live calendar's
 * (M10.3) are as the provider charges them, in its currency, so new exchange rates never change a feed, with the titles
 * the user chose.
 */
export interface CalendarEventOptions {
  amounts: 'user' | 'charged';
  /** Each title's name and amount ("Netflix: $19.94"), or its name alone. */
  titles: 'name-amount' | 'name';
  /** Each title ends with its list's name, for lists kept for different people: "Netflix: $19.94 (Family)". */
  listNames: boolean;
  /**
   * Where a run of charges starts: at the first charge from today (a download, a copy as of today), or from its anchor
   * once that has passed, so a live calendar's events keep their start and UID as the days go by.
   */
  runsFrom: 'today' | 'anchor';
}

/** The .ics download's events (M7.5). */
export const downloadEventOptions: CalendarEventOptions = {
  amounts: 'user',
  titles: 'name-amount',
  listNames: false,
  runsFrom: 'today',
};

/**
 * The events of `lists` (M7.12): a repeating event for each run of an ongoing subscription's charges at one amount, and
 * an event for each charge of the rest in the next 12 months. Each is titled with what it is and costs as charged
 * ("Netflix: $19.94"; "Renew Mullvad VPN: ≈ $94.16" for one renewed by hand), its description saying its plan, its
 * list, its tax, how it renews, until when, and its tags, which are its categories too (M7.9).
 */
export function calendarEvents(
  lists: readonly ExportList[],
  context: ExportContext,
  format: ExportFormat,
  options: CalendarEventOptions = downloadEventOptions,
): CalendarEvent[] {
  const window = next12Range(context.today);
  const events: { date: IsoDate; event: CalendarEvent }[] = [];
  for (const { list, resolved: items } of lists) {
    for (const resolved of items) {
      const { billing } = resolved.item;
      // A monthly plan billed on the 29th or 30th has no rule Proton takes: a yearly series for each month (M10.25).
      const months =
        billing.mode === 'recurring' && repeatRule(billing) === undefined
          ? monthSeries(billing)
          : undefined;
      const repeats =
        billing.mode === 'recurring' &&
        !ownPeriodAddOns(resolved) &&
        (repeatRule(billing) !== undefined || months !== undefined);
      // A run that a price of the user's own ends is followed through to the regular price after it.
      const until = resolved.item.priceOverride?.until;
      const to =
        repeats && until !== undefined && until >= window.to ? addDays(until, 400) : window.to;
      // A live calendar keeps what's been paid: from the anchor once it has passed, a year back at most for charges
      // that are events of their own (M10.25).
      const from =
        options.runsFrom === 'anchor' &&
        billing.mode === 'recurring' &&
        billing.anchorDate < window.from
          ? repeats
            ? billing.anchorDate
            : maxDate(billing.anchorDate, addDays(window.from, -365))
          : window.from;
      const charges = itemCharges(resolved, { from, to }, context.place);
      if (!repeats || billing.mode !== 'recurring') {
        for (const charge of charges.filter((one) => one.date < window.to)) {
          events.push({
            date: charge.date,
            event: chargeEvent(charge, resolved, list.name, context, format, options),
          });
        }
        continue;
      }
      const runs = runsOf(charges, options);
      runs.forEach((run, index) => {
        const next = runs[index + 1];
        // Charges are before the end date; the next run starts the day after this one's last.
        const last = next
          ? addDays(next[0].date, -1)
          : billing.endDate === undefined
            ? undefined
            : addDays(billing.endDate, -1);
        // A price of the user's own ends the run, or the plan's end does.
        const note = next
          ? `At this price until ${format.date(addDays(next[0].date, -1))}`
          : billing.endDate === undefined
            ? undefined
            : `Ends ${format.date(billing.endDate)}`;
        const series = months?.flatMap(({ month, day }) => {
          const start = firstOn(run[0].date, month, day);
          return last !== undefined && start > last
            ? []
            : [{ start, rule: `FREQ=YEARLY;INTERVAL=1;BYMONTH=${month};BYMONTHDAY=${day}` }];
        });
        for (const { start, rule } of series ?? [{ start: run[0].date, rule: undefined }]) {
          events.push({
            date: start,
            event: runEvent(
              { ...run[0], date: start },
              last,
              note,
              billing,
              resolved,
              list.name,
              context,
              format,
              options,
              rule,
            ),
          });
        }
      });
    }
  }
  return events
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(({ event }) => event);
}

/** Whether an add-on is billed on a period of its own (Disney+'s monthly extra member on a yearly plan). */
function ownPeriodAddOns(resolved: ResolvedItem): boolean {
  return resolved.addOns.some((addOn) => !samePeriod(addOn.price, resolved.item.billing));
}

/** A charge's amount as the events show it: in the user's currency, or as the provider charges it. */
function shown(charge: Charge, options: CalendarEventOptions): Charged {
  return options.amounts === 'charged' ? charge.charged : charge;
}

/** Charges in runs of the same amount, currency and renewal, as shown: a price that changes starts a run. */
function runsOf(charges: readonly Charge[], options: CalendarEventOptions): Charge[][] {
  const runs: Charge[][] = [];
  for (const charge of charges) {
    const run = runs.at(-1);
    const first = run && shown(run[0], options);
    const next = shown(charge, options);
    if (
      run &&
      first &&
      Math.round(first.amount * 100) === Math.round(next.amount * 100) &&
      first.currency === next.currency &&
      run[0].manual === charge.manual
    ) {
      run.push(charge);
    } else {
      runs.push([charge]);
    }
  }
  return runs;
}

/**
 * The repeat rule of an ongoing item's charges from one of them on (M7.12), as the schedule has them: a month's or
 * year's on the anchor's day, or its billing day, falling on a shorter month's last day; `last` is the last day a charge
 * can fall on. Only in the forms Proton Calendar takes (M10.2): one day of the month, and no BYSETPOS without a
 * weekday (its web client's getIsRruleSupported, read 2026-10-29), so a month's 31st is BYMONTHDAY=-1, its last day,
 * and a year's day its month's own (February's last for the 29th). A monthly plan billed on the 29th or 30th has no
 * such rule (February would need a second day), so undefined: its charges are events of their own.
 */
export function repeatRule(
  billing: Extract<Billing, { mode: 'recurring' }>,
  last?: IsoDate,
): string | undefined {
  const [, month, day] = billing.anchorDate.split('-').map(Number);
  const dayOfMonth = billing.billingDay ?? day;
  const every = `INTERVAL=${billing.intervalCount}`;
  let rule: string;
  if (billing.interval === 'day' || billing.interval === 'week') {
    rule = `FREQ=${billing.interval === 'day' ? 'DAILY' : 'WEEKLY'};${every}`;
  } else if (billing.interval === 'month') {
    if (dayOfMonth === 29 || dayOfMonth === 30) return undefined;
    rule = `FREQ=MONTHLY;${every};BYMONTHDAY=${dayOfMonth === 31 ? -1 : dayOfMonth}`;
  } else {
    // February's 29th and later fall on its last day; another month's day on the most it has.
    const longest = new Date(Date.UTC(2001, month, 0)).getUTCDate();
    const yearDay =
      month === 2 ? (dayOfMonth >= 29 ? -1 : dayOfMonth) : Math.min(dayOfMonth, longest);
    rule = `FREQ=YEARLY;${every};BYMONTH=${month};BYMONTHDAY=${yearDay}`;
  }
  return last === undefined ? rule : `${rule};UNTIL=${last.replaceAll('-', '')}`;
}

/**
 * A monthly plan billed on the 29th or 30th (M10.25) as a yearly series for each month, which Proton Calendar takes
 * (a monthly rule can't name months there, and a yearly one names one): each month on that day, February on its last
 * (-1), as the schedule moves it. Undefined for any other plan, and every few months, which stay events of their own.
 */
export function monthSeries(
  billing: Extract<Billing, { mode: 'recurring' }>,
): { month: number; day: number }[] | undefined {
  const dayOfMonth = billing.billingDay ?? Number(billing.anchorDate.slice(8, 10));
  if (billing.interval !== 'month' || billing.intervalCount !== 1) return undefined;
  if (dayOfMonth !== 29 && dayOfMonth !== 30) return undefined;
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    day: index === 1 ? -1 : dayOfMonth,
  }));
}

/** The first date on or after `from` in `month` on `day` (-1: its last). */
function firstOn(from: IsoDate, month: number, day: number): IsoDate {
  const year = Number(from.slice(0, 4));
  const on = (inYear: number) => {
    const length = new Date(Date.UTC(inYear, month, 0)).getUTCDate();
    const date = day === -1 ? length : Math.min(day, length);
    return `${inYear}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  };
  return on(year) >= from ? on(year) : on(year + 1);
}

function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

function runEvent(
  first: Charge,
  last: IsoDate | undefined,
  note: string | undefined,
  billing: Extract<Billing, { mode: 'recurring' }>,
  resolved: ResolvedItem,
  listName: string,
  context: ExportContext,
  format: ExportFormat,
  options: CalendarEventOptions,
  rule?: string,
): CalendarEvent {
  const event = chargeEvent(first, resolved, listName, context, format, options, note);
  return {
    ...event,
    uid: `${first.itemId}-from-${first.date}-${shown(first, options).currency}@${uidDomain}`,
    recurrenceRule:
      rule === undefined
        ? repeatRule(billing, last)
        : last === undefined
          ? rule
          : `${rule};UNTIL=${last.replaceAll('-', '')}`,
  };
}

/** An event for one charge, or the first of a run, with a note on until when it repeats. */
function chargeEvent(
  charge: Charge,
  resolved: ResolvedItem,
  listName: string,
  context: ExportContext,
  format: ExportFormat,
  options: CalendarEventOptions,
  until?: string,
): CalendarEvent {
  const name = resolved.item.nickname ?? resolved.name;
  const tags = resolved.item.tagIds.flatMap((id) => context.tags.get(id)?.name ?? []);
  const amount = `${charge.converted ? '≈ ' : ''}${format.money(charge.amount, charge.currency)}`;
  const { amount: titleAmount, currency } = shown(charge, options);
  const priced =
    options.amounts === 'charged'
      ? `${name}: ${format.money(titleAmount, currency)}`
      : `${name}: ${amount}`;
  const what = options.titles === 'name' ? name : priced;
  const title = charge.manual ? `Renew ${what}` : what;
  return {
    uid: `${charge.itemId}-${charge.date}-${currency}@${uidDomain}`,
    start: calendarDate(charge.date),
    end: calendarDate(addDays(charge.date, 1)),
    title: options.listNames ? `${title} (${listName})` : title,
    description: [
      itemTitle(resolved),
      `List: ${listName}`,
      charge.tax > 0 ? `${amount}, with ${format.money(charge.tax, charge.currency)} tax` : amount,
      charge.manual ? 'Renew manually' : 'Renews automatically',
      ...(until !== undefined ? [until] : []),
      ...(charge.ends && until === undefined ? ['Its last charge before it ends'] : []),
      ...(tags.length > 0 ? [`Tags: ${tags.join(', ')}`] : []),
    ].join('\n'),
    ...(tags.length > 0 && { categories: tags }),
  };
}

function calendarDate(date: IsoDate): CalendarDate {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}
