import type { IsoDate } from '../dates/iso-date';
import { monthOf } from '../dates/iso-month';
import { next12Range } from '../schedule/list-metrics';
import type { ExportFormat } from './calendar-events';
import { exportCharges, roundMoney, type ExportContext, type ExportList } from './export-tables';

// The Calendar's JSON and Text exports (PROJECT-PLAN P10, M7.9): the payment schedule of the lists shown, the next 12
// months' charges as the CSV has them, to use elsewhere or to read.

/** A charge, as the JSON has it. */
export interface PaymentEntry {
  date: IsoDate;
  list: string;
  /** The provider, bundle or custom subscription. */
  name: string;
  plan?: string;
  nickname?: string;
  /** As charged, sales tax included, in `currency`. */
  amount: number;
  tax: number;
  currency: string;
  /** Converted from another currency, at the day's rate: an estimate. */
  converted?: true;
  renews: 'automatically' | 'manually';
  /** Its item's last charge before it ends. */
  last?: true;
  /** Its item's live tags, by name. */
  tags?: string[];
}

/** What the Calendar's JSON holds. Not a backup: Import refuses it (user/backup.ts). */
export interface PaymentsFile {
  app: 'simply-sub';
  file: 'payments';
  exportedOn: IsoDate;
  /** The next 12 months (PROJECT-PLAN §3.1). */
  from: IsoDate;
  to: IsoDate;
  lists: string[];
  payments: PaymentEntry[];
}

/** The lists' charges in the next 12 months, in date order, for the Calendar's JSON export. */
export function paymentsFile(lists: readonly ExportList[], context: ExportContext): PaymentsFile {
  const { from, to } = next12Range(context.today);
  return {
    app: 'simply-sub',
    file: 'payments',
    exportedOn: context.today,
    from,
    to,
    lists: lists.map(({ list }) => list.name),
    payments: exportCharges(lists, context).map(({ charge, resolved, listName }) => {
      const tags = resolved.item.tagIds.flatMap((id) => context.tags.get(id)?.name ?? []);
      return {
        date: charge.date,
        list: listName,
        name: resolved.name,
        ...(resolved.planName !== undefined && { plan: resolved.planName }),
        ...(resolved.item.nickname !== undefined && { nickname: resolved.item.nickname }),
        amount: roundMoney(charge.amount, charge.currency),
        tax: roundMoney(charge.tax, charge.currency),
        currency: charge.currency,
        ...(charge.converted && { converted: true as const }),
        renews: charge.manual ? 'manually' : 'automatically',
        ...(charge.ends && { last: true as const }),
        ...(tags.length > 0 && { tags }),
      };
    }),
  };
}

/**
 * The lists' payment schedule as text, to read, print or paste (M7.9): the lists and the day it was exported, then each
 * month of the next 12 with its total and its charges: the day, what it's for and its list, what it costs as charged,
 * its tax, and a manual renewal or its last charge.
 */
export function paymentsText(
  lists: readonly ExportList[],
  context: ExportContext,
  format: ExportFormat,
): string {
  const charges = exportCharges(lists, context);
  const lines = [
    'Simply Sub payments',
    `Exported on ${format.date(context.today)}, for the next 12 months`,
    `Lists: ${lists.map(({ list }) => list.name).join(', ')}`,
  ];
  if (charges.length === 0) return `${[...lines, '', 'No payments.'].join('\n')}\n`;
  const months = new Map<string, typeof charges>();
  for (const one of charges) {
    const month = monthOf(one.charge.date);
    months.set(month, [...(months.get(month) ?? []), one]);
  }
  for (const [month, inMonth] of months) {
    const totals = new Map<string, { amount: number; converted: boolean }>();
    for (const { charge } of inMonth) {
      const total = totals.get(charge.currency) ?? { amount: 0, converted: false };
      totals.set(charge.currency, {
        amount: total.amount + charge.amount,
        converted: total.converted || charge.converted,
      });
    }
    const total = [...totals]
      .map(
        ([currency, { amount, converted }]) =>
          `${converted ? '≈ ' : ''}${format.money(amount, currency)}`,
      )
      .join(' + ');
    lines.push('', `${format.month(month)}: ${total}`);
    for (const { charge, resolved, listName } of inMonth) {
      const name = resolved.item.nickname ?? resolved.name;
      const plan = resolved.planName === undefined ? '' : ` ${resolved.planName}`;
      const amount = `${charge.converted ? '≈ ' : ''}${format.money(charge.amount, charge.currency)}`;
      const tax = charge.tax > 0 ? `, with ${format.money(charge.tax, charge.currency)} tax` : '';
      const notes = [
        ...(charge.manual ? ['renew manually'] : []),
        ...(charge.ends ? ['its last charge'] : []),
      ];
      lines.push(
        `  ${format.date(charge.date)}: ${name}${plan} (${listName}), ${amount}${tax}` +
          (notes.length > 0 ? `; ${notes.join(', ')}` : ''),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
