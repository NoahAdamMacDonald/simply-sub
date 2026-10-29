import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { MatAutocomplete, MatAutocompleteTrigger, MatOption } from '@angular/material/autocomplete';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatChipGrid, MatChipInput, MatChipRemove, MatChipRow } from '@angular/material/chips';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { freeTagColor, parseTagColor, tagNamed, type Tag } from '@simply-sub/core';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ColourPicker } from './colour-picker';
import { TagColours } from './tag-colours';
import { TagDeleter } from './tag-deleter';

/** The autocomplete's "Create tag" choice: never a tag's id, which is a UUID. */
const createChoice = 'create';

let nextId = 0;

/**
 * Picks an item's tags (P6): the chosen ones as chips, an autocomplete of the others, and "Create tag “…”", which
 * opens a row for the new tag's name and colour and saves it through TagsRepository. "Delete a tag" beside the field
 * is a menu of the tags, which deletes one everywhere, asking first when it's in use (M6.11): an ✕ inside a
 * suggestion would be a button in an option, which the arrow keys skip and axe fails. The new tag's colour is a
 * preset, a hex colour or one from the device's picker, as on Settings (M6.15); renaming belongs to Settings (P13).
 */
@Component({
  selector: 'ss-tag-picker',
  imports: [
    ColourPicker,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatButton,
    MatChipGrid,
    MatChipInput,
    MatChipRemove,
    MatChipRow,
    MatFormField,
    MatHint,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatOption,
    TagColours,
  ],
  templateUrl: './tag-picker.html',
  styleUrl: './tag-picker.scss',
})
export class TagPicker {
  private readonly tags = inject(TagsRepository);
  private readonly deleter = inject(TagDeleter);
  private readonly injector = inject(Injector);
  private readonly chipInput = viewChild.required<ElementRef<HTMLInputElement>>('chipInput');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly trigger = viewChild.required(MatAutocompleteTrigger);
  private readonly autocomplete = viewChild.required(MatAutocomplete);

  /** The chosen tags' ids, in the order they were added (ListItem.tagIds). */
  readonly tagIds = model<readonly string[]>([]);
  readonly label = input('Tags');

  protected readonly records = this.tags.records;
  protected readonly createChoice = createChoice;
  private readonly id = nextId++;
  protected readonly headingId = `ss-tag-picker-${this.id}-new`;
  protected readonly query = signal('');
  /** The tag being created, while its row is open. */
  protected readonly draft = signal<{ name: string; color: string } | undefined>(undefined);
  protected readonly saving = signal(false);
  protected readonly failed = signal(false);
  /** The hex field's text: the new tag's colour, until something else is typed (M6.15). */
  protected readonly hexText = linkedSignal(() => this.draft()?.color ?? '');
  /** What's typed in the hex field isn't a colour. */
  protected readonly hexError = computed(() =>
    this.draft() !== undefined && parseTagColor(this.hexText()) === undefined
      ? 'Use six hex digits, like #1e88e5'
      : undefined,
  );

  protected readonly chosen = computed(() => {
    const byId = this.tags.byId();
    return this.tagIds().flatMap((id) => byId.get(id) ?? []);
  });
  protected readonly matches = computed(() => {
    const typed = this.query().trim().toLocaleLowerCase('en');
    const chosen = new Set(this.tagIds());
    return this.tags
      .records()
      .filter((tag) => !chosen.has(tag.id) && tag.name.toLocaleLowerCase('en').includes(typed));
  });
  /** The chips make a grid, as Material has it: there are some, or text is typed. */
  protected readonly isGrid = computed(() => this.chosen().length > 0 || this.query() !== '');
  /** The typed name, when no tag has it yet. */
  protected readonly newName = computed(() => {
    const name = this.query().trim();
    return name !== '' && this.named(name) === undefined ? name : undefined;
  });

  protected pick(choice: string): void {
    if (choice === createChoice) this.startCreate(this.query().trim());
    else this.add(choice);
    this.chipInput().nativeElement.value = '';
    this.query.set('');
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

  protected remove(id: string): void {
    this.tagIds.update((ids) => ids.filter((candidate) => candidate !== id));
  }

  /**
   * "Delete a tag": the tag goes everywhere, after asking when it's in use, and off this item's chips too. Focus goes
   * back to the menu's button, or to the field once no tag is left.
   */
  protected async deleteTag(tag: Tag): Promise<void> {
    if (!(await this.deleter.delete(tag))) return;
    this.remove(tag.id);
    if (this.tags.records().every((candidate) => candidate.id === tag.id)) {
      this.chipInput().nativeElement.focus();
    }
  }

  protected rename(name: string): void {
    this.draft.update((draft) => draft && { ...draft, name });
  }

  protected recolour(color: string): void {
    this.draft.update((draft) => draft && { ...draft, color });
  }

  /** The hex field: once it's a colour, it's the new tag's, and the swatches and the picker follow. */
  protected typeHex(text: string): void {
    this.hexText.set(text);
    const color = parseTagColor(text);
    if (color !== undefined && color !== this.draft()?.color) this.recolour(color);
  }

  protected async create(): Promise<void> {
    const draft = this.draft();
    const name = draft?.name.trim();
    if (!draft || !name || this.saving() || this.hexError() !== undefined) return;
    this.saving.set(true);
    this.failed.set(false);
    try {
      // The name may have been changed to an existing tag's since "Create" was picked.
      const tag = this.named(name) ?? (await this.tags.create({ name, color: draft.color }));
      this.add(tag.id);
      this.closeCreate();
    } catch {
      this.failed.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  protected closeCreate(): void {
    this.draft.set(undefined);
    this.failed.set(false);
    this.chipInput().nativeElement.focus();
  }

  private add(id: string): void {
    if (!this.tagIds().includes(id)) this.tagIds.update((ids) => [...ids, id]);
  }

  private startCreate(name: string): void {
    this.draft.set({ name, color: this.freeColour() });
    afterNextRender(() => this.nameInput()?.nativeElement.focus(), { injector: this.injector });
  }

  private named(name: string): Tag | undefined {
    return tagNamed(this.tags.records(), name);
  }

  /** The first preset no tag has yet, so new tags look different. */
  private freeColour(): string {
    return freeTagColor(this.tags.records());
  }
}
