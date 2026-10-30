import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
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
  /**
   * The words for the choice with no value, shown as the empty field's placeholder rather than as its text, so typing
   * starts at once (Search's Category, "All": the feedback after M10, part 2). The list still offers that choice.
   */
  readonly placeholder = input<string>();
  /** The user picked a choice; the value is it already. */
  readonly picked = output<string>();

  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  private readonly trigger = viewChild.required(MatAutocompleteTrigger);
  private readonly matInput = viewChild(MatInput);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  /** A press began in the list and hasn't picked anything yet: it moves focus off the field first. */
  private pressingList = false;

  private readonly labels = computed(
    () => new Map(this.choices().map((choice) => [choice.value, choice.label])),
  );
  /** The chosen one's name: what the field shows until something else is typed. */
  private readonly chosenLabel = computed(() => this.textOf(this.value()));
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
    value === null ? '' : this.textOf(value);

  constructor() {
    // matInput works out its error state only with a form control of its own: this field tells it.
    effect(() => {
      this.invalid();
      this.touched();
      this.matInput()?.updateErrorState();
    });
    inject(DestroyRef).onDestroy(() => this.stopWatching());
  }

  /**
   * The form's focus, on a field with an error (`focusFirstError`): its list stays closed, so the message under the
   * field shows. Typing, a click or the arrow keys open it.
   */
  focus(options?: FocusOptions): void {
    this.box().nativeElement.focus(options);
    this.trigger().closePanel();
  }

  protected type(text: string): void {
    this.text.set(text);
    this.query.set(text);
  }

  /**
   * A click on the chosen name selects it, as Tab's focus does, so what's typed next takes its place rather than
   * following it ("CanadaUn"). Once something is typed, a click places the caret.
   */
  protected clicked(box: HTMLInputElement): void {
    if (!this.typing()) box.select();
  }

  protected pick(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value as string;
    this.value.set(value);
    this.text.set(this.textOf(value));
    this.picked.emit(value);
  }

  /**
   * Tab (or Shift+Tab) closes the list before focus moves on, picking nothing, as Material's own Tab does once the list
   * is set up. Pressed right after the list opened, Tab came before that: the list was left open over the next field,
   * or, half drawn, sent focus out of the page.
   */
  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') this.trigger().closePanel();
  }

  /**
   * Focus left: touched, and the field shows the chosen name again (a choice clicked in the list, which takes focus
   * from it first, then shows its own). Focus moved to another control some other way, as the form does to a field
   * it's missing, closes the list too, as the tag picker's does, and so does focus that went nowhere: an iPhone's
   * keyboard Done (the feedback after M10, part 2). A choice pressed with a mouse or a finger moves focus to the
   * dialog that holds the field, or nowhere on a page, before it's picked, so the list stays for it.
   */
  protected leave(event: FocusEvent): void {
    this.touch.emit();
    this.text.set(this.chosenLabel());
    const next = event.relatedTarget;
    const list = this.list();
    const elsewhere =
      next === null
        ? !this.pressingList
        : next instanceof Node &&
          event.target instanceof Node &&
          !next.contains(event.target) &&
          !list?.contains(next);
    if (elsewhere) this.trigger().closePanel();
  }

  /** The list opened: a press anywhere else now closes it. */
  protected watch(): void {
    this.document.addEventListener('pointerdown', this.pressed, true);
    this.document.addEventListener('pointercancel', this.cancelled, true);
  }

  /** What the field shows for `value`: its choice's name, or nothing for the one with no value when it has a placeholder. */
  private textOf(value: string): string {
    return value === '' && this.placeholder() !== undefined ? '' : (this.labels().get(value) ?? '');
  }

  /** The list closed: it shows them all next time, and the field the chosen name. */
  protected settle(): void {
    this.stopWatching();
    this.query.set('');
    this.text.set(this.chosenLabel());
  }

  private stopWatching(): void {
    this.pressingList = false;
    this.document.removeEventListener('pointerdown', this.pressed, true);
    this.document.removeEventListener('pointercancel', this.cancelled, true);
  }

  /**
   * A press outside the field and its list closes the list (the feedback after M10, part 2). Material closes it on a
   * click elsewhere only once focus has left the field, and an iPhone leaves focus in a field when a tap lands on
   * something that can't take it, so there the list stayed open over the page.
   */
  private readonly pressed = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    this.pressingList = this.list()?.contains(target) ?? false;
    if (!this.pressingList && !this.host.nativeElement.contains(target)) {
      this.trigger().closePanel();
    }
  };

  /** A press in the list that became a scroll picks nothing. */
  private readonly cancelled = (): void => {
    this.pressingList = false;
  };

  private list(): HTMLElement | undefined {
    return this.trigger().autocomplete?.panel?.nativeElement as HTMLElement | undefined;
  }
}
