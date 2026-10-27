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
import { MatButton } from '@angular/material/button';
import { MatChipGrid, MatChipInput, MatChipRemove, MatChipRow } from '@angular/material/chips';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { tagColorPresets, type Tag } from '@simply-sub/core';
import { TagsRepository } from '../../core/storage/tags-repository';

/** The autocomplete's "Create tag" choice: never a tag's id, which is a UUID. */
const createChoice = 'create';

let nextId = 0;

/**
 * Picks an item's tags (P6): the chosen ones as chips, an autocomplete of the others, and "Create tag “…”", which
 * opens a row for the new tag's name and colour and saves it through TagsRepository. Renaming, any hex colour and
 * deleting tags belong to Settings (P13).
 */
@Component({
  selector: 'ss-tag-picker',
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatButton,
    MatChipGrid,
    MatChipInput,
    MatChipRemove,
    MatChipRow,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatOption,
  ],
  templateUrl: './tag-picker.html',
  styleUrl: './tag-picker.scss',
})
export class TagPicker {
  private readonly tags = inject(TagsRepository);
  private readonly injector = inject(Injector);
  private readonly chipInput = viewChild.required<ElementRef<HTMLInputElement>>('chipInput');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  /** The chosen tags' ids, in the order they were added (ListItem.tagIds). */
  readonly tagIds = model<readonly string[]>([]);
  readonly label = input('Tags');

  protected readonly presets = tagColorPresets;
  protected readonly createChoice = createChoice;
  private readonly id = nextId++;
  protected readonly headingId = `ss-tag-picker-${this.id}-new`;
  protected readonly colourName = `ss-tag-picker-${this.id}-colour`;
  protected readonly query = signal('');
  /** The tag being created, while its row is open. */
  protected readonly draft = signal<{ name: string; color: string } | undefined>(undefined);
  protected readonly saving = signal(false);
  protected readonly failed = signal(false);

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

  protected remove(id: string): void {
    this.tagIds.update((ids) => ids.filter((candidate) => candidate !== id));
  }

  protected rename(name: string): void {
    this.draft.update((draft) => draft && { ...draft, name });
  }

  protected recolour(color: string): void {
    this.draft.update((draft) => draft && { ...draft, color });
  }

  protected async create(): Promise<void> {
    const draft = this.draft();
    const name = draft?.name.trim();
    if (!draft || !name || this.saving()) return;
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
    const wanted = name.toLocaleLowerCase('en');
    return this.tags.records().find((tag) => tag.name.trim().toLocaleLowerCase('en') === wanted);
  }

  /** The first preset no tag has yet, so new tags look different; once all are taken, they go round again. */
  private freeColour(): string {
    const tags = this.tags.records();
    const used = new Set(tags.map((tag) => tag.color.toLowerCase()));
    const free = this.presets.find((preset) => !used.has(preset.color));
    return (free ?? this.presets[tags.length % this.presets.length]).color;
  }
}
