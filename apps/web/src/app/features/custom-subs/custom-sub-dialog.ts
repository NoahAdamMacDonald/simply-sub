import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, validateTree, type FieldTree } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import {
  customSubChange,
  customSubFormFor,
  customSubFormIssues,
  customSubFromForm,
  intervalSchema,
  newCustomPlan,
  newCustomSubForm,
  taxAddedRegions,
  type CustomSubChange,
  type CustomSubForm,
  type CustomSubscription,
  type FeatureValue,
  type Interval,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { focusFirstError } from '../../shared/focus-first-error';
import { issueErrors } from '../../shared/form-issues';
import { currencyChoices } from '../../shared/place-choices';
import { fillScreenWhenNarrow } from '../../shared/wide-dialog';
import { FeaturePicker } from './feature-picker';
import { ChoiceField } from '../../shared/choice-field/choice-field';

export interface CustomSubDialogData {
  /** The custom subscription to change; none for a new one. */
  sub?: CustomSubscription;
}

/** What was saved: the custom subscription's id and name, and whether it's new. */
export interface CustomSubDialogResult {
  id: string;
  name: string;
  created: boolean;
}

const intervalNames: Record<Interval, string> = {
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  year: 'Years',
};

/**
 * The custom subscription editor (PROJECT-PLAN P12): its name and links, and its plans, each with a name, a cost, a
 * period, whether it renews by itself and its features. Core decides what it needs before it's saved
 * (customSubFormIssues). Saving a change to a plan that list items use, or removing one, asks first with their count
 * (customSubChange); a removed plan's items are removed from their lists with it.
 */
@Component({
  selector: 'ss-custom-sub-dialog',
  imports: [
    ChoiceField,
    FeaturePicker,
    FormField,
    FormRoot,
    MatButton,
    MatCheckbox,
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
  ],
  templateUrl: './custom-sub-dialog.html',
  styleUrl: './custom-sub-dialog.scss',
})
export class CustomSubDialog {
  private readonly dialogRef =
    inject<MatDialogRef<CustomSubDialog, CustomSubDialogResult>>(MatDialogRef);
  private readonly repository = inject(CustomSubsRepository);
  private readonly items = inject(ItemsRepository);
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly confirmer = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly newPlanButton = viewChild('newPlan', { read: ElementRef });

  /** The custom subscription being changed; undefined for a new one. */
  protected readonly editing = inject<CustomSubDialogData>(MAT_DIALOG_DATA).sub;
  protected readonly heading = this.editing
    ? 'Edit custom subscription'
    : 'New custom subscription';
  protected readonly currencies = currencyChoices;
  protected readonly intervals = intervalSchema.options.map((interval) => ({
    interval,
    name: intervalNames[interval],
  }));

  private readonly currency = computed(() => this.settings.saved()?.currency ?? '');
  protected readonly model = signal<CustomSubForm>(
    this.editing
      ? customSubFormFor(this.editing)
      : newCustomSubForm(this.repository.newPlanId(), this.currency()),
  );
  protected readonly form = form(
    this.model,
    (path) => {
      validateTree(path, ({ value, fieldTree }) =>
        issueErrors(fieldTree, customSubFormIssues(value())),
      );
    },
    { submission: { action: () => this.save(), onInvalid: focusFirstError } },
  );

  /** The catalog's feature registry, which a plan's features come from. */
  protected readonly registry = computed(() => this.catalog.catalog()?.features ?? []);
  /** Where tax is added on top of a price (BLUEPRINT §4.8), so "plus tax" means something. */
  protected readonly taxAdded = computed(() =>
    taxAddedRegions.has(this.settings.saved()?.country ?? ''),
  );

  constructor() {
    fillScreenWhenNarrow(this.dialogRef);
  }

  /** Adds a plan, and puts focus on its name. */
  protected addPlan(): void {
    this.model.update((form) => ({
      ...form,
      plans: [...form.plans, newCustomPlan(this.repository.newPlanId(), this.currency())],
    }));
    afterNextRender(
      () => {
        const names = this.host.nativeElement.querySelectorAll<HTMLElement>('.plan-name input');
        names[names.length - 1]?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Removes a plan; focus moves to New plan, since its button has gone. */
  protected removePlan(index: number): void {
    this.model.update((form) => ({
      ...form,
      plans: form.plans.filter((_, other) => other !== index),
    }));
    afterNextRender(() => this.newPlanButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected setFeatures(index: number, features: Readonly<Record<string, FeatureValue>>): void {
    this.model.update((form) => ({
      ...form,
      plans: form.plans.map((plan, other) =>
        other === index ? { ...plan, features: { ...features } } : plan,
      ),
    }));
  }

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** Save: asks first when list items use a plan that changed or was removed, then saves and closes. */
  private async save(): Promise<void> {
    const fields = customSubFromForm(this.model());
    if (this.editing) {
      const change = customSubChange(this.editing, fields, this.items.records());
      if (
        (change.changed > 0 || change.removed > 0) &&
        !(await this.confirmer.confirm(changeQuestion(this.editing.name, change)))
      ) {
        return;
      }
    }
    const saved = await this.repository.save(this.editing?.id, fields);
    this.dialogRef.close({ id: saved.id, name: saved.name, created: this.editing === undefined });
  }
}

/**
 * P12's warning before a change reaches list items: "1 subscription in your lists uses a plan you changed, and
 * changes with it." A removed plan's items go with it, so that asks as a deletion does.
 */
function changeQuestion(name: string, { changed, removed, removedLists }: CustomSubChange) {
  const sentences: string[] = [];
  if (changed > 0) {
    sentences.push(
      changed === 1
        ? '1 subscription in your lists uses a plan you changed, and changes with it.'
        : `${changed} subscriptions in your lists use plans you changed, and change with them.`,
    );
  }
  if (removed > 0) {
    const lists = removedLists === 1 ? '1 list' : `${removedLists} lists`;
    sentences.push(
      removed === 1
        ? `1 subscription uses a plan you removed, and is removed from ${lists}.`
        : `${removed} subscriptions use plans you removed, and are removed from ${lists}.`,
    );
  }
  return {
    title: `Save changes to ${name}?`,
    message: sentences.join(' '),
    confirmText: 'Save changes',
    danger: removed > 0,
  };
}
