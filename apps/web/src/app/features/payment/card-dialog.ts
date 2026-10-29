import { Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, validateTree, type FieldTree } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import {
  cardFormFor,
  cardFormIssues,
  cardFromForm,
  cardNetworkNames,
  cardNetworks,
  cardTitle,
  maxCardNameLength,
  newCardForm,
  type CardForm,
  type PaymentCard,
} from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
import { focusFirstError } from '../../shared/focus-first-error';
import { issueErrors } from '../../shared/form-issues';
import { currencyChoices } from '../../shared/place-choices';
import { fillScreenWhenNarrow } from '../../shared/wide-dialog';
import { ChoiceField } from '../../shared/choice-field/choice-field';

export interface CardDialogData {
  /** The card to change; none for a new one. */
  card?: PaymentCard;
}

/** What was saved: the card's id and what it's called, and whether it's new. */
export interface CardDialogResult {
  id: string;
  title: string;
  created: boolean;
}

/**
 * The card dialog (PROJECT-PLAN P11): exactly BLUEPRINT §9.2's fields, a name and nickname, credit or debit, the
 * network, the card's currency (the user's for a new card), cash back, the FX fee and a monthly limit. It never asks
 * for a card number, says so, and refuses 12 or more digits in a row in every field (core's cardFormIssues).
 */
@Component({
  selector: 'ss-card-dialog',
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
    MatHint,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
    MatSuffix,
  ],
  templateUrl: './card-dialog.html',
  styleUrl: './card-dialog.scss',
})
export class CardDialog {
  private readonly dialogRef = inject<MatDialogRef<CardDialog, CardDialogResult>>(MatDialogRef);
  private readonly repository = inject(CardsRepository);
  private readonly settings = inject(SettingsStore);

  /** The card being changed; undefined for a new one. */
  protected readonly editing = inject<CardDialogData>(MAT_DIALOG_DATA).card;
  protected readonly heading = this.editing ? `Edit ${cardTitle(this.editing)}` : 'Add a card';
  protected readonly maxNameLength = maxCardNameLength;
  protected readonly currencies = currencyChoices;
  protected readonly types = [
    { value: 'credit', label: 'Credit' },
    { value: 'debit', label: 'Debit' },
  ] as const;
  protected readonly networks = cardNetworks.map((network) => ({
    value: network,
    label: cardNetworkNames[network],
  }));

  protected readonly model = signal<CardForm>(
    this.editing ? cardFormFor(this.editing) : newCardForm(this.settings.saved()?.currency ?? ''),
  );
  protected readonly form = form(
    this.model,
    (path) => {
      validateTree(path, ({ value, fieldTree }) => issueErrors(fieldTree, cardFormIssues(value())));
    },
    { submission: { action: () => this.save(), onInvalid: focusFirstError } },
  );
  /** The limit's currency, beside its field: the card's. */
  protected readonly limitCurrency = computed(() => this.model().currency);

  constructor() {
    fillScreenWhenNarrow(this.dialogRef);
  }

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** Saves the card and closes. */
  private async save(): Promise<void> {
    const fields = cardFromForm(this.model());
    const saved = this.editing
      ? await this.repository.update(this.editing.id, {
          // A nickname or limit left empty is cleared.
          nickname: undefined,
          monthlyLimit: undefined,
          ...fields,
        })
      : await this.repository.create(fields);
    this.dialogRef.close({
      id: saved.id,
      title: cardTitle(saved),
      created: this.editing === undefined,
    });
  }
}
