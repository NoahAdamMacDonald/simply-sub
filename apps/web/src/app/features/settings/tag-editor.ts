import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, validate, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { freeTagColor, parseTagColor, tagNameIssue, type Tag } from '@simply-sub/core';
import { TagsRepository } from '../../core/storage/tags-repository';
import { focusFirstError } from '../../shared/focus-first-error';
import { TagColours } from '../../shared/tags/tag-colours';

/** Which field the editor opens on: ✎ opens the name, the colour swatch its colours. */
export type TagEditorFocus = 'name' | 'colour';

/**
 * A tag's row on Settings while it's edited (P13, M6.11), or ⊕'s new tag: its name, one of the 12 preset colours or a
 * hex colour, then Save or Cancel. Enter saves and Escape cancels. The names follow core's rules (tagNameIssue): one,
 * trimmed, that no other tag has in any case.
 */
@Component({
  selector: 'ss-tag-editor',
  imports: [
    FormField,
    FormRoot,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    TagColours,
  ],
  templateUrl: './tag-editor.html',
  styleUrl: './tag-editor.scss',
})
export class TagEditor {
  private readonly tags = inject(TagsRepository);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  /** The tag being changed; none for a new one. */
  readonly tag = input<Tag>();
  readonly focus = input<TagEditorFocus>('name');
  /** Done: the saved tag, or undefined when cancelled. */
  readonly closed = output<Tag | undefined>();

  /**
   * The name and the colour as typed. They start from the tag, or for a new one an empty name and the first preset no
   * tag has yet, and only a different tag starts them again: a change made in another tab doesn't wipe what's typed.
   */
  private readonly model = linkedSignal({
    source: () => this.tag()?.id,
    computation: () =>
      untracked(() => {
        const tag = this.tag();
        return { name: tag?.name ?? '', color: tag?.color ?? freeTagColor(this.tags.records()) };
      }),
  });
  protected readonly form = form(
    this.model,
    (path) => {
      validate(path.name, ({ value }) => {
        const message = tagNameIssue(value(), this.tags.records(), this.tag()?.id);
        return message === undefined ? undefined : { kind: 'tag-name', message };
      });
      validate(path.color, ({ value }) =>
        parseTagColor(value()) === undefined
          ? { kind: 'tag-color', message: 'Use six hex digits, like #1e88e5' }
          : undefined,
      );
    },
    { submission: { action: () => this.save(), onInvalid: focusFirstError } },
  );
  /** The colour the swatches show checked: the typed one, once it's a colour. */
  protected readonly chosen = computed(() => parseTagColor(this.form.color().value()) ?? '');

  constructor() {
    afterNextRender(() => {
      if (this.focus() === 'name') {
        this.nameInput().nativeElement.focus();
        return;
      }
      // The colour it has, else the first: a hex colour that's no preset has none checked.
      const colours = this.host.nativeElement.querySelector('ss-tag-colours');
      (
        colours?.querySelector<HTMLInputElement>('input:checked') ??
        colours?.querySelector<HTMLInputElement>('input')
      )?.focus();
    });
  }

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  protected pick(color: string): void {
    this.form.color().value.set(color);
  }

  protected cancel(): void {
    this.closed.emit(undefined);
  }

  private async save(): Promise<void> {
    const name = this.model().name.trim();
    const color = parseTagColor(this.model().color) ?? '';
    const tag = this.tag();
    const saved = tag
      ? await this.tags.update(tag.id, { name, color })
      : await this.tags.create({ name, color });
    this.closed.emit(saved);
  }
}
