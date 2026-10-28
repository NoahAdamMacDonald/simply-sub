import { manualRenewal, periodCost, type Charge } from '../schedule/charges';
import { chargesIn, listMetrics, next12Range, type MoneyContext } from '../schedule/list-metrics';
import { periodText, sourceText, unresolvedText } from '../user/item-text';
import type { ListItem } from '../user/list-item';
import type { ResolvedItem, UnresolvedItem } from '../user/resolved';
import type { SubscriptionList } from '../user/subscription-list';
import type { Tag } from '../user/tag';

// The exports' tables (BLUEPRINT §11.2, M7.5): what the CSV files and the Excel workbook hold, as rows of plain values
// that the app gives papaparse and exceljs. Amounts are numbers rounded to their currency's minor unit, beside its
// code, and dates are ISO, so a spreadsheet reads them as numbers and dates. Items name their live tags only (M6.11).

/** One list and its items, as the app has them priced. */
export interface ExportList {
  list: SubscriptionList;
  resolved: readonly ResolvedItem[];
  unresolved: readonly UnresolvedItem[];
}

/** What every export needs: today, the user's currency and tax place, and their tags. */
export interface ExportContext extends MoneyContext {
  /** The user's tags by id. A deleted one isn't there, so an item's id for it is left out. */
  tags: ReadonlyMap<string, Tag>;
}

/** What a column holds: words, an amount in the row's currency, that currency's code, a date, or a count. */
export type ExportColumnKind = 'text' | 'money' | 'currency' | 'date' | 'count';

export interface ExportColumn {
  header: string;
  kind: ExportColumnKind;
}

/** A cell: words, a number, an ISO date, or nothing. */
export type ExportCell = string | number | null;

/** A header and its rows: a CSV file, or a sheet of the workbook. */
export interface ExportTable {
  columns: readonly ExportColumn[];
  rows: readonly (readonly ExportCell[])[];
}

/** A sheet of the Excel workbook, named as Excel allows (sheetNames). */
export interface ExportSheet extends ExportTable {
  name: string;
}

const itemColumns: readonly ExportColumn[] = [
  { header: 'List', kind: 'text' },
  { header: 'Service', kind: 'text' },
  { header: 'Plan', kind: 'text' },
  { header: 'Nickname', kind: 'text' },
  { header: 'Cost', kind: 'money' },
  { header: 'Tax', kind: 'money' },
  { header: 'Currency', kind: 'currency' },
  { header: 'Converted', kind: 'text' },
  { header: 'Billed', kind: 'text' },
  { header: 'Renews', kind: 'text' },
  { header: 'Next charge', kind: 'date' },
  { header: 'Ends', kind: 'date' },
  { header: 'Status', kind: 'text' },
  { header: 'Tags', kind: 'text' },
];

const paymentColumns: readonly ExportColumn[] = [
  { header: 'Date', kind: 'date' },
  { header: 'List', kind: 'text' },
  { header: 'Service', kind: 'text' },
  { header: 'Plan', kind: 'text' },
  { header: 'Nickname', kind: 'text' },
  { header: 'Amount', kind: 'money' },
  { header: 'Tax', kind: 'money' },
  { header: 'Currency', kind: 'currency' },
  { header: 'Converted', kind: 'text' },
  { header: 'Renews', kind: 'text' },
  { header: 'Last charge', kind: 'text' },
];

const summaryColumns: readonly ExportColumn[] = [
  { header: 'List', kind: 'text' },
  { header: 'This month', kind: 'money' },
  { header: 'This year', kind: 'money' },
  { header: 'Next 12 months', kind: 'money' },
  { header: 'Currency', kind: 'currency' },
  { header: 'Converted', kind: 'text' },
  { header: 'Not counted', kind: 'count' },
];

/**
 * A row for each item of `lists` (List view's CSV, and each list's sheet of the workbook, without its List column):
 * what it is, what a charge of its billing period costs today as charged, sales tax included, how it's billed and
 * renews, its next charge, its end date, its status and its live tags. One that can't be priced says why in Status.
 */
export function itemTable(
  lists: readonly ExportList[],
  context: ExportContext,
  { withList = true } = {},
): ExportTable {
  const rows = lists.flatMap(({ list, resolved, unresolved }) => [
    ...resolved.map((one) => [list.name, ...resolvedCells(one, context)]),
    ...unresolved.map((one) => [list.name, ...unresolvedCells(one, context)]),
  ]);
  return withList
    ? { columns: itemColumns, rows }
    : { columns: itemColumns.slice(1), rows: rows.map((row) => row.slice(1)) };
}

/** A charge, with its item and its list's name. */
export interface ExportCharge {
  charge: Charge;
  resolved: ResolvedItem;
  listName: string;
}

/** The charges of `lists` in the next 12 months, from today, in date order: the payment schedule and the .ics. */
export function exportCharges(
  lists: readonly ExportList[],
  { today, place }: MoneyContext,
): ExportCharge[] {
  const items = new Map(
    lists.flatMap(({ list, resolved }) =>
      resolved.map((one) => [one.item.id, { resolved: one, listName: list.name }] as const),
    ),
  );
  return chargesIn(
    lists.flatMap((list) => list.resolved),
    next12Range(today),
    place,
  ).flatMap((charge) => {
    const item = items.get(charge.itemId);
    return item ? [{ charge, ...item }] : [];
  });
}

/**
 * A row for each charge of `lists` in the next 12 months, in date order (the Calendar's payment schedule, P10): its
 * date, what it's for, what it costs as charged, sales tax included, how it renews, and whether it's the last before
 * the item ends.
 */
export function paymentTable(lists: readonly ExportList[], context: ExportContext): ExportTable {
  const rows = exportCharges(lists, context).map(({ charge, resolved, listName }) => [
    charge.date,
    listName,
    resolved.name,
    resolved.planName,
    resolved.item.nickname ?? null,
    roundMoney(charge.amount, charge.currency),
    roundMoney(charge.tax, charge.currency),
    charge.currency,
    charge.converted ? 'yes' : null,
    charge.manual ? 'Manually' : 'Automatically',
    charge.ends ? 'yes' : null,
  ]);
  return { columns: paymentColumns, rows };
}

/**
 * Each list's totals (PROJECT-PLAN §3.1, as its page shows them): this month, this year and the next 12 months, sales
 * tax included, in the user's currency; whether they include a converted amount; and how many items they leave out.
 * With more than one list, a Total row adds them all up.
 */
export function summaryTable(lists: readonly ExportList[], context: ExportContext): ExportTable {
  const { currency } = context;
  const row = (name: string, items: Pick<ExportList, 'resolved' | 'unresolved'>): ExportCell[] => {
    const totals = listMetrics(items, { ...context, registry: [] });
    return [
      name,
      roundMoney(totals.thisMonth, currency),
      roundMoney(totals.thisYear, currency),
      roundMoney(totals.next12, currency),
      currency,
      totals.approx ? 'yes' : null,
      totals.notCounted,
    ];
  };
  const rows = lists.map((list) => row(list.list.name, list));
  if (lists.length > 1) {
    rows.push(
      row('Total', {
        resolved: lists.flatMap((list) => list.resolved),
        unresolved: lists.flatMap((list) => list.unresolved),
      }),
    );
  }
  return { columns: summaryColumns, rows };
}

/**
 * The Excel workbook (BLUEPRINT §11.2): Summary, a sheet of each list's items, then Payments, the next 12 months'
 * charges.
 */
export function exportWorkbook(
  lists: readonly ExportList[],
  context: ExportContext,
): ExportSheet[] {
  const names = sheetNames(
    lists.map(({ list }) => list.name),
    ['Summary', 'Payments'],
  );
  return [
    { name: 'Summary', ...summaryTable(lists, context) },
    ...lists.map((list, index) => ({
      name: names[index],
      ...itemTable([list], context, { withList: false }),
    })),
    { name: 'Payments', ...paymentTable(lists, context) },
  ];
}

/** The longest sheet name Excel takes. */
const maxSheetName = 31;

/**
 * Sheet names for `names` (the lists'), as Excel takes them: none of : \ / ? * [ ], no ' at either end, at most 31
 * characters, never empty ("List"), and unique in any case, with " (2)" after one already used here or in `taken`, or
 * that Excel keeps for itself ("History").
 */
export function sheetNames(names: readonly string[], taken: readonly string[] = []): string[] {
  const used = new Set([...taken, 'History'].map(folded));
  return names.map((name) => {
    const cleaned = name
      .replace(/[:\\/?*[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s']+|[\s']+$/g, '');
    const base = cut(cleaned, maxSheetName).trimEnd() || 'List';
    let candidate = base;
    for (let count = 2; used.has(folded(candidate)); count++) {
      const suffix = ` (${count})`;
      candidate = `${cut(base, maxSheetName - suffix.length).trimEnd()}${suffix}`;
    }
    used.add(folded(candidate));
    return candidate;
  });
}

/** Each currency's digits after the point, once worked out. */
const minorUnits = new Map<string, number>();

/** How many digits a currency has after the point: 2 for cents, none for yen. */
export function currencyDigits(currency: string): number {
  let digits = minorUnits.get(currency);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    minorUnits.set(currency, digits);
  }
  return digits;
}

/**
 * `amount` rounded to its currency's minor unit, as the app shows it ($19.94, ¥2,290): what a spreadsheet adds up. Like
 * Intl, it rounds the number's exact value.
 */
export function roundMoney(amount: number, currency: string): number {
  return Number(amount.toFixed(currencyDigits(currency)));
}

function resolvedCells(
  resolved: ResolvedItem,
  { today, place, tags }: ExportContext,
): ExportCell[] {
  const { item } = resolved;
  const cost = periodCost(resolved, today, place);
  return [
    resolved.name,
    resolved.planName,
    item.nickname ?? null,
    roundMoney(cost.amount, cost.currency),
    roundMoney(cost.tax, cost.currency),
    cost.currency,
    cost.converted ? 'yes' : null,
    billedText(item),
    manualRenewal(resolved) ? 'Manually' : 'Automatically',
    resolved.nextCharge?.date ?? null,
    endDate(item),
    resolved.status.kind === 'active' ? 'Active' : 'Inactive',
    tagNames(item, tags),
  ];
}

/** What's known of an item that can't be priced: its source, how it's billed, its tags, and why. */
function unresolvedCells({ item, reason }: UnresolvedItem, { tags }: ExportContext): ExportCell[] {
  const { billing } = item;
  return [
    sourceText(item.source),
    null,
    item.nickname ?? null,
    null,
    null,
    null,
    null,
    billedText(item),
    billing.mode === 'recurring' ? (billing.autoRenew ? 'Automatically' : 'Manually') : null,
    null,
    endDate(item),
    unresolvedText(reason),
    tagNames(item, tags),
  ];
}

/** "Monthly", "Every 3 months", "Specific dates, billed monthly". */
function billedText({ billing }: ListItem): string {
  const period = periodText(billing.interval, billing.intervalCount);
  if (billing.mode === 'limited') return `Specific dates, billed ${period}`;
  return period[0].toUpperCase() + period.slice(1);
}

function endDate({ billing }: ListItem): string | null {
  return billing.mode === 'recurring' ? (billing.endDate ?? null) : null;
}

/** The names of the item's live tags, "Family, Work"; none for an item without any. */
function tagNames(item: ListItem, tags: ReadonlyMap<string, Tag>): string | null {
  const names = item.tagIds.flatMap((id) => tags.get(id)?.name ?? []);
  return names.length === 0 ? null : names.join(', ');
}

/** `text` cut to `length` UTF-16 units, without splitting a character in two. */
function cut(text: string, length: number): string {
  if (text.length <= length) return text;
  const last = text.charCodeAt(length - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? length - 1 : length);
}

/** A sheet name as Excel compares them, in any case. */
function folded(name: string): string {
  return name.toLocaleLowerCase('en');
}
