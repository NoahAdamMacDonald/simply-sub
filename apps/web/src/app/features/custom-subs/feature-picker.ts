import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { MatAutocomplete, MatAutocompleteTrigger, MatOption } from '@angular/material/autocomplete';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import {
  customFeatureChoices,
  featureMatches,
  featureValueText,
  isFeatureValue,
  type Feature,
  type FeatureValue,
} from '@simply-sub/core';

let nextId = 0;

/**
 * A custom plan's features (P12): each with its value and a button that removes it, then "Add a feature", which finds
 * one in the registry as Search's Features box does (core's featureMatches). A yes-or-no feature is added at once;
 * any other asks for its value first: one of an enum's, a number or Unlimited, or one or more of a set's.
 */
@Component({
  selector: 'ss-feature-picker',
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
    MatSuffix,
  ],
  templateUrl: './feature-picker.html',
  styleUrl: './feature-picker.scss',
})
export class FeaturePicker {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  private readonly trigger = viewChild.required(MatAutocompleteTrigger);
  private readonly autocomplete = viewChild.required(MatAutocomplete);

  /** Feature id → value, as a custom plan stores them. */
  readonly features = model<Readonly<Record<string, FeatureValue>>>({});
  /** The catalog's feature registry. */
  readonly registry = input.required<readonly Feature[]>();
  /** The plan's name, which names its list. */
  readonly planName = input('');

  protected readonly ids = `ss-feature-picker-${nextId++}`;
  protected readonly query = signal('');
  private readonly choices = computed(() => customFeatureChoices(this.registry()));
  protected readonly matches = computed(() =>
    featureMatches(this.choices(), this.query(), this.features()),
  );

  /** The plan's features in registry order, each as it reads: "Ad free", "Simultaneous streams: 2 devices". */
  protected readonly listed = computed(() => {
    const features = this.features();
    const registry = this.registry();
    const known = registry.filter((feature) => Object.hasOwn(features, feature.id));
    // A feature the registry has dropped stays the user's, named by its id.
    const unknown = Object.keys(features).filter(
      (id) => !registry.some((feature) => feature.id === id),
    );
    return [
      ...known.map((feature) => ({
        id: feature.id,
        text: featureText(feature, features[feature.id]),
      })),
      ...unknown.map((id) => ({ id, text: id })),
    ];
  });

  /** The feature whose value is being asked for. */
  protected readonly pending = signal<Feature | undefined>(undefined);
  protected readonly enumValue = signal('');
  protected readonly amount = signal<number | null>(null);
  protected readonly unlimited = signal(false);
  protected readonly setValues = signal<readonly string[]>([]);
  protected readonly valueError = signal<string | undefined>(undefined);

  /** A feature picked from the suggestions: added, or its value asked for. */
  protected pick(id: string): void {
    this.box().nativeElement.value = '';
    this.query.set('');
    const feature = this.choices().find((candidate) => candidate.id === id);
    if (!feature) return;
    if (feature.type === 'boolean') {
      this.add(feature.id, true);
      return;
    }
    this.enumValue.set('');
    this.amount.set(null);
    this.unlimited.set(false);
    this.setValues.set([]);
    this.valueError.set(undefined);
    this.pending.set(feature);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>('.value input, .value .mat-mdc-select')
          ?.focus(),
      { injector: this.injector },
    );
  }

  /**
   * Closes the suggestions when focus moves on to another control, as Tab does. Material closes them on Tab only once
   * their panel has rendered, which in a zoneless app can come after the Tab, and an empty panel left open then takes
   * the dialog's next Escape. A click on a suggestion moves focus to the dialog, which holds the field, so that's left
   * to Material, as are clicks elsewhere.
   */
  protected leave(event: FocusEvent): void {
    const next = event.relatedTarget;
    const panel = this.autocomplete().panel?.nativeElement as HTMLElement | undefined;
    if (
      next instanceof Node &&
      event.target instanceof Node &&
      !next.contains(event.target) &&
      !panel?.contains(next)
    ) {
      this.trigger().closePanel();
    }
  }

  protected toggleSetValue(id: string, checked: boolean): void {
    this.setValues.update((values) =>
      checked ? [...values, id] : values.filter((value) => value !== id),
    );
  }

  /** Adds the pending feature with the value given, or says what's missing. */
  protected confirm(): void {
    const feature = this.pending();
    if (!feature) return;
    const value = this.pendingValue(feature);
    if (value === undefined || !isFeatureValue(feature, value)) {
      this.valueError.set(
        feature.type === 'number'
          ? 'Enter a number, 0 or more, or tick Unlimited'
          : feature.type === 'set'
            ? 'Choose at least one'
            : 'Choose a value',
      );
      return;
    }
    this.add(feature.id, value);
  }

  protected cancel(): void {
    this.pending.set(undefined);
    this.box().nativeElement.focus();
  }

  /** Removes a feature; focus moves to "Add a feature", since its button has gone. */
  protected remove(id: string): void {
    this.features.update((features) =>
      Object.fromEntries(Object.entries(features).filter(([other]) => other !== id)),
    );
    this.box().nativeElement.focus();
  }

  private add(id: string, value: FeatureValue): void {
    this.features.update((features) => ({ ...features, [id]: value }));
    this.pending.set(undefined);
    afterNextRender(() => this.box().nativeElement.focus(), { injector: this.injector });
  }

  private pendingValue(feature: Feature): FeatureValue | undefined {
    switch (feature.type) {
      case 'enum':
        return this.enumValue() || undefined;
      case 'number':
        return this.unlimited() ? 'unlimited' : (this.amount() ?? undefined);
      case 'set':
        // In the registry's order, whatever order they were ticked in.
        return (feature.values ?? [])
          .map((option) => option.id)
          .filter((id) => this.setValues().includes(id));
      case 'boolean':
        return true;
    }
  }
}

/** "Ad free"; "Simultaneous streams: 2 devices". */
function featureText(feature: Feature, value: FeatureValue): string {
  return feature.type === 'boolean'
    ? feature.name
    : `${feature.name}: ${featureValueText(feature, value)}`;
}
