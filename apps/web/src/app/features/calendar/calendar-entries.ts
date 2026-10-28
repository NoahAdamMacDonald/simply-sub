import type { Charge, IsoDate, ListItem } from '@simply-sub/core';

// What the Calendar shows of a charge (P10, M7.4): the charge, and what it's for, as the grid's chips, the agenda and
// the day panel name it.

/** One charge with what it's for. */
export interface CalendarEntry {
  /** Unique on its day: an item can be charged in two currencies when one has no rate. */
  key: string;
  charge: Charge;
  item: ListItem;
  /** What the grid's chip says: a nickname, else the service's name ("Netflix"). */
  name: string;
  /** "Netflix Standard", or "Mom's (Netflix Standard)". */
  title: string;
  iconUrl?: string;
  listName: string;
}

/** A day's charges. */
export interface CalendarDay {
  date: IsoDate;
  entries: CalendarEntry[];
}
