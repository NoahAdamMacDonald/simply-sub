import { manualRenewal, periodCost } from '../schedule/charges';
import { listMetrics } from '../schedule/list-metrics';
import { addOnText, itemTitle, periodText, sourceText, unresolvedText } from '../user/item-text';
import type { ListItem } from '../user/list-item';
import type { ResolvedItem, UnresolvedItem } from '../user/resolved';
import type { Tag } from '../user/tag';
import type { ExportFormat } from './calendar-events';
import type { ExportContext, ExportList } from './export-tables';

// List view's Text export (BLUEPRINT §11.2, M7.5): a summary to read, print or paste into a message.

/**
 * A list as text: its name and the day it was exported; its totals this month, this year and over the next 12 months
 * (PROJECT-PLAN §3.1), sales tax included; then each item with what a charge of its period costs as charged, how it
 * renews, its next charge, end date, add-ons, own price, status, live tags and note; and the items that can't be
 * priced, with why.
 */
export function listText(
  { list, resolved, unresolved }: ExportList,
  context: ExportContext,
  format: ExportFormat,
): string {
  const { today, currency } = context;
  const totals = listMetrics({ resolved, unresolved }, { ...context, registry: [] });
  const total = (amount: number, converted: boolean) =>
    `${converted ? '≈ ' : ''}${format.money(amount, currency)}`;
  const count = resolved.length + unresolved.length;
  const lines = [
    list.name,
    `Exported from Simply Sub on ${format.date(today)}`,
    '',
    `This month: ${total(totals.thisMonth, totals.converted.thisMonth)}`,
    `This year: ${total(totals.thisYear, totals.converted.thisYear)}`,
    `Next 12 months: ${total(totals.next12, totals.converted.next12)}`,
    ...(totals.notCounted === 0
      ? []
      : [
          totals.notCounted === 1
            ? '1 subscription isn’t counted in these totals.'
            : `${totals.notCounted} subscriptions aren’t counted in these totals.`,
        ]),
    '',
    count === 1 ? '1 subscription' : `${count} subscriptions`,
  ];
  for (const one of resolved) lines.push('', ...itemLines(one, context, format));
  for (const one of unresolved) lines.push('', ...unresolvedLines(one, context.tags));
  return `${lines.join('\n')}\n`;
}

function itemLines(
  resolved: ResolvedItem,
  { today, place, tags }: ExportContext,
  format: ExportFormat,
): string[] {
  const { item, nextCharge, status } = resolved;
  const { billing } = item;
  const cost = periodCost(resolved, today, place);
  const period = periodText(billing.interval, billing.intervalCount);
  const costText =
    cost.amount === 0
      ? 'Free'
      : [
          `${cost.converted ? '≈ ' : ''}${format.money(cost.amount, cost.currency)} ${period}`,
          ...(billing.mode === 'limited' ? [' on specific dates'] : []),
          ...(cost.tax > 0 ? [`, with ${format.money(cost.tax, cost.currency)} tax`] : []),
        ].join('');
  const own = item.priceOverride;
  const until = own?.until === undefined ? '' : ` until ${format.date(own.until)}`;
  return [
    itemTitle(resolved),
    `  Cost: ${costText}`,
    ...(cost.amount === 0
      ? []
      : [`  ${manualRenewal(resolved) ? 'Renew manually' : 'Renews automatically'}`]),
    nextCharge ? `  Next charge: ${format.date(nextCharge.date)}` : '  No charge to come',
    ...(billing.mode === 'recurring' && billing.endDate !== undefined
      ? [`  Ends: ${format.date(billing.endDate)}`]
      : []),
    ...(resolved.addOns.length === 0
      ? []
      : [`  Add-ons: ${resolved.addOns.map(addOnText).join(', ')}`]),
    // While it applies, or still to come (M9.6), with what it'll be.
    ...(!own || (own.until !== undefined && own.until <= today)
      ? []
      : own.since === undefined || own.since <= today
        ? [`  Your own price${until}`]
        : [
            `  Your own price from ${format.date(own.since)}${until}: ${format.money(own.amount, own.currency)} ${period}${own.plusTax ? ' + tax' : ''}`,
          ]),
    `  Status: ${
      status.kind === 'active'
        ? 'Active'
        : status.activeFrom === undefined
          ? 'Inactive'
          : `Inactive until ${format.date(status.activeFrom)}`
    }`,
    ...tagLines(item, tags),
    ...noteLines(item),
  ];
}

/** What's known of an item that can't be priced, and why. */
function unresolvedLines(
  { item, reason }: UnresolvedItem,
  tags: ReadonlyMap<string, Tag>,
): string[] {
  const source = sourceText(item.source);
  return [
    item.nickname === undefined ? source : `${item.nickname} (${source})`,
    `  Can’t be priced: ${unresolvedText(reason)}`,
    ...tagLines(item, tags),
    ...noteLines(item),
  ];
}

function tagLines(item: ListItem, tags: ReadonlyMap<string, Tag>): string[] {
  const names = item.tagIds.flatMap((id) => tags.get(id)?.name ?? []);
  return names.length === 0 ? [] : [`  Tags: ${names.join(', ')}`];
}

/** The item's note, its lines indented under the label's. */
function noteLines({ note }: ListItem): string[] {
  return note === undefined ? [] : [`  Note: ${note.replace(/\r?\n/g, '\n        ')}`];
}
