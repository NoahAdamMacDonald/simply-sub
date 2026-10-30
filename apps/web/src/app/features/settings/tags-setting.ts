import {
  Component,
  computed,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { namesakes, tagColorName, type Tag } from '@simply-sub/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { openSnack, snackMillis } from '../../shared/snack/snack';
import { TagDeleter } from '../../shared/tags/tag-deleter';
import { TagEditor, type TagEditorFocus } from './tag-editor';

/** The row open for editing: a tag's, or ⊕'s new one. */
interface Editing {
  id: string | 'new';
  focus: TagEditorFocus;
}

/** Where focus goes once the rows have caught up with a change, and what it waits for. */
interface PendingFocus {
  ready(tags: readonly Tag[]): boolean;
  selector: string;
}

/** How many tags show before Show all (M4.7). */
const foldAfter = 6;

/**
 * Custom tags on Settings (P13, M6.11): a row per tag with its colour, which opens its palette, its name, ✎ to rename
 * it in place, and ✕ to delete it, asking first when subscriptions use it; then ⊕ for a new tag, in edit mode. A tag
 * with the name of one before it (two devices' tags, joined by a merge or sync) says so, with Merge into it (M10.24).
 * The item dialog's tag picker creates and deletes tags too, so every page follows the repository live.
 */
@Component({
  selector: 'ss-tags-setting',
  imports: [MatButton, MatIcon, MatIconButton, TagEditor],
  templateUrl: './tags-setting.html',
  styleUrl: './tags-setting.scss',
})
export class TagsSetting {
  private readonly tags = inject(TagsRepository);
  private readonly deleter = inject(TagDeleter);
  private readonly confirmer = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly records = this.tags.records;
  /** A long list folds after its first few (M4.7), with Show all; one being edited shows it all. */
  protected readonly showAll = signal(false);
  protected readonly foldAfter = foldAfter;
  protected readonly shown = computed(() => {
    const records = this.records();
    const open = this.editing()?.id;
    const unfolded = this.showAll() || records.slice(foldAfter).some((tag) => tag.id === open);
    return unfolded ? records : records.slice(0, foldAfter);
  });
  protected readonly status = this.tags.status;
  protected readonly editing = signal<Editing | undefined>(undefined);
  private readonly pendingFocus = signal<PendingFocus | undefined>(undefined);
  protected readonly colourName = tagColorName;
  /** Each tag with the name of one before it, and that one (M10.24). */
  protected readonly namesakes = computed(() => namesakes(this.records()));

  constructor() {
    effect(() => {
      const pending = this.pendingFocus();
      if (!pending || !pending.ready(this.records())) return;
      this.pendingFocus.set(undefined);
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>(pending.selector)?.focus(),
        { injector: this.injector },
      );
    });
  }

  protected edit(id: string | 'new', focus: TagEditorFocus): void {
    this.editing.set({ id, focus });
  }

  /**
   * The editor closed: focus goes back to what opened it, or for a new tag to its ✎ once it's listed (⊕ when it was
   * cancelled).
   */
  protected closed({ id, focus }: Editing, saved: Tag | undefined): void {
    this.editing.set(undefined);
    if (id === 'new') {
      this.pendingFocus.set(
        saved
          ? {
              ready: (tags) => tags.some((tag) => tag.id === saved.id),
              selector: rowButton(saved.id, 'rename'),
            }
          : { ready: () => true, selector: '.add' },
      );
      return;
    }
    this.pendingFocus.set({
      ready: () => true,
      selector: rowButton(id, focus === 'name' ? 'rename' : 'swatch'),
    });
  }

  /**
   * Merge into it (M10.24): after asking, the tag's subscriptions get the first tag of its name instead, and it's
   * deleted. Focus goes to that tag's ✎.
   */
  protected async merge(tag: Tag, into: Tag): Promise<void> {
    const count = await this.tags.usage(tag.id);
    const confirmed = await this.confirmer.confirm({
      title: `Merge the two “${into.name}” tags?`,
      message: `${count === 1 ? 'Its 1 subscription gets' : `Its ${count} subscriptions get`} the first “${into.name}” tag, in its colour, and this one is deleted.`,
      confirmText: 'Merge',
    });
    if (!confirmed) return;
    await this.tags.mergeInto(tag.id, into.id);
    openSnack(this.snackBar, `Merged into ${into.name}`, undefined, { duration: snackMillis });
    this.pendingFocus.set({
      ready: (shown) => !shown.some((candidate) => candidate.id === tag.id),
      selector: rowButton(into.id, 'rename'),
    });
  }

  /** ✕: deleted, after asking when it's in use. Focus moves to the next row's ✕, else the previous one's, else ⊕. */
  protected async remove(tag: Tag): Promise<void> {
    const tags = this.records();
    const index = tags.findIndex((candidate) => candidate.id === tag.id);
    const next = tags[index + 1] ?? tags[index - 1];
    if (!(await this.deleter.delete(tag))) return;
    this.pendingFocus.set({
      ready: (shown) => !shown.some((candidate) => candidate.id === tag.id),
      selector: next ? rowButton(next.id, 'remove') : '.add',
    });
  }
}

/** A row's button. Tag ids are UUIDs, which need no escaping. */
function rowButton(id: string, button: 'swatch' | 'rename' | 'remove'): string {
  return `[data-tag="${id}"] .${button}`;
}
