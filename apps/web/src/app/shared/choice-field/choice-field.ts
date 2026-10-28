import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { FormValueControl, ValidationError } from '@angular/forms/signals';
import {
  MatAutocomplete,
  MatAutocompleteTrigger,
  type MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatOption, type ErrorStateMatcher } from '@angular/material/core';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';

/** A choice: its value, and what it's called. */
export interface Choice {
  value: string;
  label: string;
}

/** Text as it's compared: lower case, without accents ("Québec" is "quebec"). */
function folded(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .trim();
}

/**
 * A menu you can type in (P1, P13, M6.16): typing narrows a long list (countries, provinces and states, currencies) to
 * the choices whose name starts with the text, then those that have it anywhere, or whose code starts with it. Enter
 * picks the first, or a click or the arrow keys one, and leaving it without picking puts back the one chosen. With
 * nothing typed it lists them all, and Enter is left to the form. A Signal Forms control: [formField] binds its value,
 * errors and touched state, and focusing its field focuses it.
 */
@Component({
  selector: 'ss-choice-field',
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatError,
    MatFormField,
    MatHint,
    MatIcon,
    MatInput,
    MatLabel,
    MatOption,
    MatSuffix,
  ],
  templateUrl: './choice-field.html',
  styleUrl: './choice-field.scss',
  host: { '[attr.data-label]': 'label()' },
})
export class ChoiceField implements FormValueControl<string> {
  /** The chosen choice's value. */
  readonly value = model('');
  readonly errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  readonly invalid = input(false);
  readonly touched = input(false);
  readonly touch = output<void>();

  readonly label = input.required<string>();
  readonly choices = input.required<readonly Choice[]>();
  readonly hint = input<string>();
  /** The user picked a choice; the value is it already. */
  readonly picked = output<string>();

  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  private readonly trigger = viewChild.required(MatAutocompleteTrigger);
  private readonly matInput = viewChild(MatInput);

  private readonly labels = computed(
    () => new Map(this.choices().map((choice) => [choice.value, choice.label])),
  );
  /** The chosen one's name: what the field shows until something else is typed. */
  private readonly chosenLabel = computed(() => this.labels().get(this.value()) ?? '');
  /** What the field shows: the chosen name, or what's typed. */
  protected readonly text = linkedSignal(() => this.chosenLabel());
  /**
   * What narrows the list: what was typed since it opened, none for them all. It changes only as the user types, so
   * the list stays put under a click that blurs the field.
   */
  private readonly query = signal('');
  /** Something is typed: the list is narrowed, and Enter picks its first. */
  protected readonly typing = computed(() => folded(this.query()) !== '');
  protected readonly matches = computed(() => {
    const choices = this.choices();
    const typed = folded(this.query());
    if (typed === '') return choices;
    const starts = choices.filter((choice) => folded(choice.label).startsWith(typed));
    const rest = choices.filter(
      (choice) =>
        !starts.includes(choice) &&
        (folded(choice.label).includes(typed) || folded(choice.value).startsWith(typed)),
    );
    return [...starts, ...rest];
  });
  protected readonly error = computed(() => this.errors()[0]?.message);
  /** Its error shows once it's been touched, as the other fields' do. */
  protected readonly errorState: ErrorStateMatcher = {
    isErrorState: () => this.invalid() && this.touched(),
  };
  protected readonly display = (value: string | null): string =>
    value === null ? '' : (this.labels().get(value) ?? '');

  constructor() {
    // matInput works out its error state only with a form control of its own: this field tells it.
    effect(() => {
      this.invalid();
      this.touched();
      this.matInput()?.updateErrorState();
    });
  }

  focus(options?: FocusOptions): void {
    this.box().nativeElement.focus(options);
  }

  protected type(text: string): void {
    this.text.set(text);
    this.query.set(text);
  }

  protected pick(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value as string;
    this.value.set(value);
    this.text.set(this.labels().get(value) ?? '');
    this.picked.emit(value);
  }

  /**
   * Focus left: touched, and the field shows the chosen name again (a choice clicked in the list, which takes focus
   * from it first, then shows its own). Focus moving on to another control closes the list: Tab pressed right after
   * the list opened came before the list could close itself, and left it open over the next field. Focus moving into
   * the list (a choice pressed with a mouse or a finger) leaves it open, for the click to pick it.
   */
  protected leave(event: FocusEvent): void {
    this.touch.emit();
    this.text.set(this.chosenLabel());
    const to = event.relatedTarget;
    const list = this.trigger().autocomplete?.panel?.nativeElement as HTMLElement | undefined;
    if (to instanceof HTMLElement && !list?.contains(to) && !to.closest('.cdk-overlay-pane')) {
      this.trigger().closePanel();
    }
  }

  /** The list closed: it shows them all next time, and the field the chosen name. */
  protected settle(): void {
    this.query.set('');
    this.text.set(this.chosenLabel());
  }
}
