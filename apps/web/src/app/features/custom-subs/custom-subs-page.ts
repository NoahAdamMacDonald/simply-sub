import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  customIconUrl,
  customSubUsage,
  type CustomSubUsage,
  type CustomSubscription,
} from '@simply-sub/core';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { PageHeader } from '../../shared/page-header/page-header';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { CustomSubEditor } from './custom-sub-editor';

/** A custom subscription as its row shows it. */
interface SubRow {
  sub: CustomSubscription;
  iconUrl?: string;
  /** "2 plans · used in 1 list", "1 plan · not used". */
  details: string;
  usage: CustomSubUsage;
}

/** Where focus goes once the rows have caught up: a new subscription's ✎, or the row after a deleted one. */
interface PendingFocus {
  ready(rows: readonly SubRow[]): boolean;
  target(): HTMLElement | null | undefined;
}

/**
 * Custom subscriptions (PROJECT-PLAN P12): services that aren't in the catalog, each with its icon (GET /icon for its
 * website, else its first letter), its plans and how many lists use it. New and ✎ open the editor (CustomSubEditor);
 * 🗑 asks first, and removes it from the lists that have it too.
 */
@Component({
  selector: 'ss-custom-subs-page',
  imports: [EmptyState, MatButton, MatIcon, MatIconButton, PageHeader, ProviderIcon],
  templateUrl: './custom-subs-page.html',
  styleUrl: './custom-subs-page.scss',
})
export class CustomSubsPage {
  private readonly repository = inject(CustomSubsRepository);
  private readonly items = inject(ItemsRepository);
  private readonly editor = inject(CustomSubEditor);
  private readonly confirmer = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly pendingFocus = signal<PendingFocus | undefined>(undefined);

  protected readonly state = computed<'loading' | 'error' | 'ready'>(() => {
    const statuses = [this.repository.status(), this.items.status()];
    if (statuses.includes('error')) return 'error';
    return statuses.every((status) => status === 'ready') ? 'ready' : 'loading';
  });

  protected readonly rows = computed<SubRow[]>(() => {
    const items = this.items.records();
    return this.repository.records().map((sub) => {
      const usage = customSubUsage(sub.id, items);
      const iconUrl = customIconUrl(sub.link);
      return {
        sub,
        ...(iconUrl !== undefined && { iconUrl }),
        details: `${count(sub.plans.length, 'plan')} · ${
          usage.lists === 0 ? 'not used' : `used in ${count(usage.lists, 'list')}`
        }`,
        usage,
      };
    });
  });

  constructor() {
    // Focus moves once the rows show the change it waited for.
    effect(() => {
      const pending = this.pendingFocus();
      if (!pending || !pending.ready(this.rows())) return;
      this.pendingFocus.set(undefined);
      afterNextRender(() => pending.target()?.focus(), { injector: this.injector });
    });
  }

  /** New custom subscription: the editor, then its row, with focus on its ✎. */
  protected async create(): Promise<void> {
    const result = await this.editor.open();
    if (!result) return;
    this.snackBar.open(`Added ${result.name}`, undefined, { duration: 5000 });
    this.pendingFocus.set({
      ready: (rows) => rows.some((row) => row.sub.id === result.id),
      target: () => this.button(result.id, 'edit'),
    });
  }

  /** ✎: the editor for it. Focus goes back to ✎ as the dialog closes. */
  protected async edit(sub: CustomSubscription): Promise<void> {
    const result = await this.editor.open(sub);
    if (result) this.snackBar.open(`Saved ${result.name}`, undefined, { duration: 5000 });
  }

  /**
   * 🗑: after asking, deletes it and removes it from the lists that have it (P12), and moves focus to the next row's
   * 🗑 (else the previous one's, else New custom subscription).
   */
  protected async remove(row: SubRow): Promise<void> {
    const { sub, usage } = row;
    const confirmed = await this.confirmer.confirm({
      title: `Delete ${sub.name}?`,
      message:
        usage.lists === 0
          ? 'It isn’t in any of your lists.'
          : `Also remove it from ${count(usage.lists, 'list')}.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    const rows = this.rows();
    const index = rows.findIndex((candidate) => candidate.sub.id === sub.id);
    const next = rows[index + 1] ?? rows[index - 1];
    await this.repository.removeWithItems(sub.id);
    this.snackBar.open(`Deleted ${sub.name}`, undefined, { duration: 5000 });
    this.pendingFocus.set({
      ready: (shown) => !shown.some((candidate) => candidate.sub.id === sub.id),
      target: () =>
        next
          ? this.button(next.sub.id, 'remove')
          : this.host.nativeElement.querySelector<HTMLElement>('.new'),
    });
  }

  private button(subId: string, kind: 'edit' | 'remove'): HTMLElement | null {
    // Record ids are UUIDs, which need no escaping.
    return this.host.nativeElement.querySelector(`[data-sub="${subId}"] .${kind}`);
  }
}

/** "1 plan", "2 lists". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
