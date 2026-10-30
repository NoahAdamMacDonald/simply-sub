import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, validate, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatOption, MatSelect } from '@angular/material/select';
import {
  parseAmount,
  reportedPriceSchema,
  type PickedPrice,
  type PriceReport,
  type ReportProblem,
} from '@simply-sub/core';
import { ChoiceField } from '../choice-field/choice-field';
import { countryName } from '../country-name';
import { focusFirstError } from '../focus-first-error';
import { currencyChoices } from '../place-choices';
import { sendReport, type ReportSent } from './report-client';

/** What the dialog reports on: a Search card's plan, with the prices it shows, and the user's country. */
export interface ReportPriceData {
  plan: string;
  /** "Netflix Standard". */
  title: string;
  /** The prices the card shows, each with the catalog price it comes from. */
  prices: readonly PickedPrice[];
  /** The user's country: CA. */
  country: string;
}

/** A refusal in words, by what sending came to. */
const refusals: Record<Exclude<ReportSent, 'sent'>, string> = {
  offline: 'You’re offline, so nothing was sent. Send it once you’re back online.',
  busy: 'Too many reports were sent from here just now. Try again in a minute.',
  paused: 'Reports are paused for today. Try again tomorrow.',
  failed: 'The report couldn’t be sent. Try again later.',
};

/**
 * Report a wrong price (PROJECT-PLAN P8, M10.11): what's wrong with a Search card's price where the user lives, in
 * choices only: the price is different (amount, currency and billing period, filled in with the catalog's price), it's
 * not sold any more, or not sold in their country. It sends nothing else, and nothing offline; a refusal says why in
 * words. Closes with true once the report is sent.
 */
@Component({
  selector: 'ss-report-price-dialog',
  imports: [
    ChoiceField,
    FormField,
    FormRoot,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    MatOption,
    MatRadioButton,
    MatRadioGroup,
    MatSelect,
  ],
  templateUrl: './report-price-dialog.html',
  styleUrl: './report-price-dialog.scss',
})
export class ReportPriceDialog {
  private readonly dialogRef = inject<MatDialogRef<ReportPriceDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<ReportPriceData>(MAT_DIALOG_DATA);

  protected readonly countryName = countryName(this.data.country);
  protected readonly currencies = currencyChoices;
  /** The card's billing periods, a price each. */
  protected readonly periods = this.data.prices.map((price, index) => ({
    value: String(index),
    name: periodName(price),
  }));
  /** Whether the card shows a price, which "The price is different" starts from. */
  protected readonly priced = this.data.prices.length > 0;
  protected readonly problem = signal<ReportProblem>(this.priced ? 'price' : 'discontinued');
  protected readonly busy = signal(false);
  /** Why the report wasn't sent, until the next try. */
  protected readonly refusal = signal('');

  private readonly model = signal({ period: '0', ...priceFields(this.data.prices[0]) });
  protected readonly form = form(
    this.model,
    (path) => {
      // The price's fields count only for a different price.
      validate(path.amount, ({ value }) =>
        this.problem() === 'price' ? amountError(value()) : undefined,
      );
      validate(path.currency, ({ value }) =>
        this.problem() !== 'price' || currencyChoices.some((choice) => choice.value === value())
          ? undefined
          : { kind: 'currency', message: 'Choose the currency it’s charged in' },
      );
    },
    { submission: { action: () => this.send(), onInvalid: focusFirstError } },
  );

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** Another billing period: its price as the card shows it, to change. */
  protected periodChosen(): void {
    const price = this.data.prices[Number(this.model().period)];
    this.model.update((model) => ({ ...model, ...priceFields(price) }));
  }

  private async send(): Promise<void> {
    this.busy.set(true);
    this.refusal.set('');
    try {
      const sent = await sendReport(this.report());
      if (sent === 'sent') this.dialogRef.close(true);
      else this.refusal.set(refusals[sent]);
    } finally {
      this.busy.set(false);
    }
  }

  private report(): PriceReport {
    const { plan, country } = this.data;
    const problem = this.problem();
    if (problem !== 'price') return { plan, country, problem };
    const { interval, intervalCount } = this.data.prices[Number(this.model().period)];
    return {
      plan,
      country,
      problem,
      price: {
        amount: parseAmount(this.model().amount) ?? 0,
        currency: this.model().currency,
        interval,
        intervalCount,
      },
    };
  }
}

/** A price's amount and currency as the form takes them: the catalog's, before any conversion. */
function priceFields(price: PickedPrice | undefined): { amount: string; currency: string } {
  return {
    amount: price && price.source.amount > 0 ? String(price.source.amount) : '',
    currency: price?.source.currency ?? '',
  };
}

/** Why `text` isn't a price a report takes, in words; undefined when it is. */
function amountError(text: string): { kind: string; message: string } | undefined {
  const amount = parseAmount(text);
  if (amount === undefined) return { kind: 'amount', message: 'Type the price, such as 18.99' };
  const parsed = reportedPriceSchema.shape.amount.safeParse(amount);
  return parsed.success ? undefined : { kind: 'amount', message: parsed.error.issues[0].message };
}

/** "Monthly", "Yearly", "Every 3 months". */
function periodName({ interval, intervalCount }: PickedPrice): string {
  return intervalCount === 1
    ? { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[interval]
    : `Every ${intervalCount} ${interval}s`;
}
