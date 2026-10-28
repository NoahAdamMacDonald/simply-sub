import { Component, computed, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { salesTaxRate, subdivisionName, subdivisionsOf, taxAddedRegions } from '@simply-sub/core';
import { ChoiceField, type Choice } from '../../shared/choice-field/choice-field';
import { countryChoices, countryName, currencyChoices, percentText } from './place-names';
import { afterCountryChange, type LocationModel } from './settings-form';

/**
 * Country, province or state, currency and sales tax (BLUEPRINT §4.8): the fields the first-run dialog (P1) and
 * Settings' 📍 dialog (P13) share. The province or state is asked only where tax is added, from that country's list.
 * The three menus can be typed in (M6.16).
 */
@Component({
  selector: 'ss-location-fields',
  imports: [
    ChoiceField,
    FormField,
    MatCheckbox,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSuffix,
  ],
  templateUrl: './location-fields.html',
  styleUrl: './location-fields.scss',
})
export class LocationFields {
  readonly fields = input.required<FieldTree<LocationModel>>();

  protected readonly countries = countryChoices;
  protected readonly currencies = currencyChoices;

  private readonly model = computed(() => this.fields()().value());
  protected readonly country = computed(() => this.model().country);
  protected readonly taxAdded = computed(() => taxAddedRegions.has(this.country()));
  protected readonly subdivisions = computed(() => subdivisionsOf(this.country()));
  protected readonly subdivisionLabel = computed(() =>
    this.country() === 'CA' ? 'Province or territory' : 'State',
  );
  /** The country's provinces or states, and Not given where one isn't needed (the US). */
  protected readonly subdivisionChoices = computed<Choice[]>(() => [
    ...(this.country() === 'CA' ? [] : [{ value: '', label: 'Not given' }]),
    ...this.subdivisions().map((subdivision) => ({
      value: subdivision.code,
      label: subdivision.name,
    })),
  ]);

  /** "13% (Ontario)": the built-in rate for the chosen province. */
  protected readonly builtInRate = computed(() => {
    const { country, subdivision } = this.model();
    const rate = salesTaxRate({ country, subdivision: subdivision || undefined });
    return rate && `${percentText(rate.percent)} (${subdivisionName(subdivision)})`;
  });

  protected readonly countryName = computed(() => countryName(this.country()));

  /** [formField] has set the new country; the province, rate and maybe the currency follow it. */
  protected countryChanged(): void {
    this.fields()().value.update(afterCountryChange);
  }

  protected currencyChanged(): void {
    this.fields().currencyChosen().value.set(true);
  }

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }
}
