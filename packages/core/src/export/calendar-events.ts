import { addDays, type IsoDate } from '../dates/iso-date';
import type { IsoMonth } from '../dates/iso-month';
import { samePeriod } from '../dates/period';
import { itemCharges, type Charge } from '../schedule/charges';
import { next12Range } from '../schedule/list-metrics';
import type { Billing } from '../user/list-item';
import { itemTitle } from '../user/item-text';
import type { ResolvedItem } from '../user/resolved';
import type { ExportContext, ExportList } from './export-tables';

// The .ics file (BLUEPRINT §11.2, §11.3, M7.5, M7.12): an ongoing subscription is one repeating event for each run of
// charges at the same amount, its repeat rule written from the schedule's own (a plan billed on the 31st falls on a
// shorter month's last day: BYMONTHDAY=28,29,30,31 with BYSETPOS=-1; an end date is UNTIL), so it goes on past the first
// year, and a calendar shows it as long as it lasts. A price of the user's own that ends, or a plan's end, ends its run.
// Specific dates and add-ons billed on a period of their own stay an event per charge in the next 12 months, which no
// repeat rule writes exactly. The app gives the events to the `ics` package.

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
 * The events of `lists` (M7.12): a repeating event for each run of an ongoing subscription's charges at one amount, and
 * an event for each charge of the rest in the next 12 months. Each is titled with what it is and costs as charged
 * ("Netflix: $19.94"; "Renew Mullvad VPN: ≈ $94.16" for one renewed by hand), its description saying its plan, its
 * list, its tax, how it renews, until when, and its tags, which are its categories too (M7.9).
 */
export function calendarEvents(
  lists: readonly ExportList[],
  context: ExportContext,
  format: ExportFormat,
): CalendarEvent[] {
  const window = next12Range(context.today);
  const events: { date: IsoDate; event: CalendarEvent }[] = [];
  for (const { list, resolved: items } of lists) {
    for (const resolved of items) {
      const { billing } = resolved.item;
      const repeats = billing.mode === 'recurring' && !ownPeriodAddOns(resolved);
      // A run that a price of the user's own ends is followed through to the regular price after it.
      const until = resolved.item.priceOverride?.until;
      const to =
        repeats && until !== undefined && until >= window.to ? addDays(until, 400) : window.to;
      const charges = itemCharges(resolved, { from: window.from, to }, context.place);
      if (!repeats || billing.mode !== 'recurring') {
        for (const charge of charges.filter((one) => one.date < window.to)) {
          events.push({
            date: charge.date,
            event: chargeEvent(charge, resolved, list.name, context, format),
          });
        }
        continue;
      }
      const runs = runsOf(charges);
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
        events.push({
          date: run[0].date,
          event: runEvent(run[0], last, note, billing, resolved, list.name, context, format),
        });
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

/** Charges in runs of the same amount, currency and renewal: a price that changes starts a run. */
function runsOf(charges: readonly Charge[]): Charge[][] {
  const runs: Charge[][] = [];
  for (const charge of charges) {
    const run = runs.at(-1);
    const first = run?.[0];
    if (
      first &&
      Math.round(first.amount * 100) === Math.round(charge.amount * 100) &&
      first.currency === charge.currency &&
      first.manual === charge.manual
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
 * can fall on.
 */
export function repeatRule(
  billing: Extract<Billing, { mode: 'recurring' }>,
  last?: IsoDate,
): string {
  const [, month, day] = billing.anchorDate.split('-').map(Number);
  const dayOfMonth = billing.billingDay ?? day;
  // A day some months don't have: the latest of the 28th up to it that the month has.
  const days =
    dayOfMonth <= 28
      ? `BYMONTHDAY=${dayOfMonth}`
      : `BYMONTHDAY=${Array.from({ length: dayOfMonth - 27 }, (_, at) => 28 + at).join(',')};BYSETPOS=-1`;
  const every = `INTERVAL=${billing.intervalCount}`;
  const rule = {
    day: `FREQ=DAILY;${every}`,
    week: `FREQ=WEEKLY;${every}`,
    month: `FREQ=MONTHLY;${every};${days}`,
    year: `FREQ=YEARLY;${every};BYMONTH=${month};${days}`,
  }[billing.interval];
  return last === undefined ? rule : `${rule};UNTIL=${last.replaceAll('-', '')}`;
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
): CalendarEvent {
  const event = chargeEvent(first, resolved, listName, context, format, note);
  return {
    ...event,
    uid: `${first.itemId}-from-${first.date}-${first.currency}@${uidDomain}`,
    recurrenceRule: repeatRule(billing, last),
  };
}

/** An event for one charge, or the first of a run, with a note on until when it repeats. */
function chargeEvent(
  charge: Charge,
  resolved: ResolvedItem,
  listName: string,
  context: ExportContext,
  format: ExportFormat,
  until?: string,
): CalendarEvent {
  const name = resolved.item.nickname ?? resolved.name;
  const tags = resolved.item.tagIds.flatMap((id) => context.tags.get(id)?.name ?? []);
  const amount = `${charge.converted ? '≈ ' : ''}${format.money(charge.amount, charge.currency)}`;
  return {
    uid: `${charge.itemId}-${charge.date}-${charge.currency}@${uidDomain}`,
    start: calendarDate(charge.date),
    end: calendarDate(addDays(charge.date, 1)),
    title: charge.manual ? `Renew ${name}: ${amount}` : `${name}: ${amount}`,
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
