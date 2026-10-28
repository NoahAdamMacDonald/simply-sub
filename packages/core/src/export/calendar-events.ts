import { addDays, type IsoDate } from '../dates/iso-date';
import { itemTitle } from '../user/item-text';
import { exportCharges, type ExportContext, type ExportList } from './export-tables';

// The .ics file (BLUEPRINT §11.2, §11.3, M7.5): an all-day event for each charge in the next 12 months, from the
// schedule engine, rather than repeat rules, which would skip the months a plan billed on the 31st doesn't have and
// miss windows, end dates and price changes. The app gives the events to the `ics` package.

/** How the app writes money and dates: core lays the files out, and the app formats what they say. */
export interface ExportFormat {
  /** "$19.94", "US$9.99". */
  money(amount: number, currency: string): string;
  /** "Nov 12, 2026". */
  date(date: IsoDate): string;
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
}

/** The domain each event's UID ends with. */
const uidDomain = 'sub.simplely.ca';

/**
 * An event for each charge of `lists` in the next 12 months, titled with what it is and costs as charged ("Netflix:
 * $19.94"; "Renew Mullvad VPN: ≈ $94.16" for one renewed by hand), its description saying its plan, its list, its tax,
 * how it renews and whether it's the last before the item ends.
 */
export function calendarEvents(
  lists: readonly ExportList[],
  context: ExportContext,
  format: ExportFormat,
): CalendarEvent[] {
  return exportCharges(lists, context).map(({ charge, resolved, listName }) => {
    const name = resolved.item.nickname ?? resolved.name;
    const amount = `${charge.converted ? '≈ ' : ''}${format.money(charge.amount, charge.currency)}`;
    return {
      uid: `${charge.itemId}-${charge.date}-${charge.currency}@${uidDomain}`,
      start: calendarDate(charge.date),
      end: calendarDate(addDays(charge.date, 1)),
      title: charge.manual ? `Renew ${name}: ${amount}` : `${name}: ${amount}`,
      description: [
        itemTitle(resolved),
        `List: ${listName}`,
        charge.tax > 0
          ? `${amount}, with ${format.money(charge.tax, charge.currency)} tax`
          : amount,
        charge.manual ? 'Renew manually' : 'Renews automatically',
        ...(charge.ends ? ['Its last charge before it ends'] : []),
      ].join('\n'),
    };
  });
}

function calendarDate(date: IsoDate): CalendarDate {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}
