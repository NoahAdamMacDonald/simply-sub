import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { tagColorName, type Tag } from '@simply-sub/core';
import { TagsRepository } from '../../core/storage/tags-repository';
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

/**
 * Custom tags on Settings (P13, M6.11): a row per tag with its colour, which opens its palette, its name, ✎ to rename
 * it in place, and ✕ to delete it, asking first when subscriptions use it; then ⊕ for a new tag, in edit mode. The
 * item dialog's tag picker creates and deletes tags too, so every page follows the repository live.
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly records = this.tags.records;
  protected readonly status = this.tags.status;
  protected readonly editing = signal<Editing | undefined>(undefined);
  private readonly pendingFocus = signal<PendingFocus | undefined>(undefined);
  protected readonly colourName = tagColorName;

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
