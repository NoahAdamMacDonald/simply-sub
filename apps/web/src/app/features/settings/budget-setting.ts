import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, apply, form } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { SettingsStore } from '../../core/settings/settings-store';
import { focusFirstError } from './focus-first-error';
import { moneyText } from './place-names';
import { budgetSchema } from './settings-form';

/**
 * A budget on Settings (P13): click ✎ to edit it in place. Enter saves, Escape cancels, and empty means no budget.
 */
@Component({
  selector: 'ss-budget-setting',
  imports: [
    FormField,
    FormRoot,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatSuffix,
  ],
  templateUrl: './budget-setting.html',
  styleUrl: './budget-setting.scss',
})
export class BudgetSetting {
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);

  readonly budget = input.required<'monthlyBudget' | 'annualBudget'>();
  readonly label = input.required<string>();

  private readonly saved = computed(() => this.settings.saved());
  protected readonly currency = computed(() => this.saved()?.currency ?? '');
  protected readonly amountText = computed(() => {
    const saved = this.saved();
    const amount = saved?.[this.budget()];
    return saved && amount !== undefined
      ? moneyText(amount, saved.currency, saved.country)
      : 'Not set';
  });

  protected readonly editing = signal(false);
  private readonly draft = signal<{ amount: number | null }>({ amount: null });
  protected readonly form = form(this.draft, (path) => apply(path.amount, budgetSchema), {
    submission: { action: () => this.save(), onInvalid: focusFirstError },
  });
  protected readonly error = computed(() => this.form.amount().errors()[0]?.message);

  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');
  private readonly editButton = viewChild<MatIconButton, ElementRef<HTMLButtonElement>>(
    'editButton',
    { read: ElementRef },
  );

  protected edit(): void {
    this.draft.set({ amount: this.saved()?.[this.budget()] ?? null });
    this.form().reset();
    this.editing.set(true);
    afterNextRender(() => this.amountInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    this.editing.set(false);
    afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
  }

  private async save(): Promise<void> {
    await this.settings.update({ [this.budget()]: this.draft().amount ?? undefined });
    this.cancel();
  }
}
