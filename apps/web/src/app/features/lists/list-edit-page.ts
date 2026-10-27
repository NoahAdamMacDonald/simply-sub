import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormField, form, maxLength, submit, validate } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatDivider } from '@angular/material/divider';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar, type MatSnackBarRef } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink, type Params } from '@angular/router';
import {
  draftChanged,
  draftItems,
  readAddRequest,
  recordIdSchema,
  type AddRequest,
  type ListDraft,
} from '@simply-sub/core';
import { filter, firstValueFrom, map } from 'rxjs';
import { CatalogStore } from '../../core/catalog/catalog-store';
import type { AsksBeforeLeaving } from '../../core/leave-guard';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { CustomSubEditor } from '../custom-subs/custom-sub-editor';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { PageHeader } from '../../shared/page-header/page-header';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { TagChip } from '../../shared/tags/tag-chip';
import { focusFirstError } from '../../shared/focus-first-error';
import { wideDialogConfig } from '../../shared/wide-dialog';
import { averageText } from './average-text';
import { editRow, type EditRow } from './edit-rows';
import type {
  ItemDialog,
  ItemDialogData,
  ItemDialogRequest,
  ItemDialogResult,
} from './item-dialog';

/** Where focus goes once the rows have caught up with a change: the row after a removed one, or a restored one. */
interface PendingFocus {
  ready(rows: readonly EditRow[]): boolean;
  target(): HTMLElement | null | undefined;
}

/**
 * What the URL asks the item dialog to open (P5): Search's ?add= or ?addBundle= at a period (flows F1, F2 and F4), a
 * custom subscription's ?addCustom= (F3), or an item's ?item= (P4's [Edit]).
 */
type AskedFor =
  AddRequest | { kind: 'custom'; customSubId: string } | { kind: 'item'; itemId: string };

/** The query parameters that ask for the item dialog, which leave the URL once the editor has answered them. */
const dialogParams = [
  'add',
  'addBundle',
  'addCustom',
  'item',
  'interval',
  'count',
  'price',
  'currency',
  'plusTax',
];

/**
 * List edit (PROJECT-PLAN P5), for new and existing lists, on the list's draft (ListDraftService, M6.3): every change
 * is kept in Dexie, so a trip to Search in pick mode or a reload keeps it, and Save writes it all at once. /lists/new
 * makes a new list's draft and opens its editor in its place. Leaving with unsaved changes asks first (leaveGuard),
 * except for Search in pick mode for this list. The item dialog (P6) opens from ✎, and once for ?add=, ?addBundle=,
 * ?addCustom= and ?item=, which then leave the URL.
 */
@Component({
  selector: 'ss-list-edit-page',
  imports: [
    EmptyState,
    FormField,
    MatButton,
    MatDivider,
    MatError,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    PageHeader,
    PriceTag,
    ProviderIcon,
    RouterLink,
    TagChip,
  ],
  templateUrl: './list-edit-page.html',
  styleUrl: './list-edit-page.scss',
})
export class ListEditPage implements AsksBeforeLeaving {
  private readonly drafts = inject(ListDraftService);
  private readonly metrics = inject(MetricsService);
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly tags = inject(TagsRepository);
  protected readonly customSubs = inject(CustomSubsRepository);
  private readonly customSubEditor = inject(CustomSubEditor);
  private readonly confirmer = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly params = toSignal(this.route.queryParams, { requireSync: true });

  /** Set once Save, Cancel or Delete list has started: the page is on its way out, and asks nothing more. */
  private leaving = false;
  /** Whether the draft has been in the store since it started, so its going means another tab saved or dropped it. */
  private stored = false;
  private undo?: MatSnackBarRef<unknown>;
  private readonly pendingFocus = signal<PendingFocus | undefined>(undefined);
  /** The query parameters the item dialog was last answered for, so it opens once for them. */
  private answered?: Params;
  private itemDialog?: { close(): void };

  /** The list's id: none on /lists/new, which makes the new list's draft and moves to its editor. */
  protected readonly listId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('listId') ?? undefined)),
    { requireSync: true },
  );

  /** The draft as it was resumed, or started from the list; undefined for a list there isn't. */
  private readonly started = resource({
    params: () => this.listId(),
    loader: ({ params: listId }) => this.drafts.start(listId),
  });
  private readonly startedDraft = computed(() =>
    this.started.hasValue() ? this.started.value() : undefined,
  );

  protected readonly state = computed<'loading' | 'missing' | 'error' | 'ready'>(() => {
    if (this.started.status() === 'error') return 'error';
    if (this.listId() === undefined || this.started.isLoading()) return 'loading';
    return this.startedDraft() ? 'ready' : 'missing';
  });

  /** The draft as stored now: it follows every change, in this tab or another one. */
  protected readonly draft = computed<ListDraft | undefined>(() => {
    const listId = this.listId();
    const started = this.startedDraft();
    if (listId === undefined || !started) return undefined;
    return this.drafts.byList().get(listId) ?? started.draft;
  });
  protected readonly heading = computed(() => (this.draft()?.isNew ? 'New list' : 'Edit list'));
  /** It opened on changes that weren't saved: "Resumed unsaved changes" (P5). */
  protected readonly resumed = computed(() => {
    const started = this.startedDraft();
    return started !== undefined && started.resumed && draftChanged(started.draft);
  });

  private readonly nameModel = linkedSignal(() => ({
    name: this.startedDraft()?.draft.name ?? '',
  }));
  protected readonly nameForm = form(
    this.nameModel,
    (path) => {
      validate(path.name, ({ value }) =>
        value().trim() === '' ? { kind: 'required', message: 'Give the list a name' } : undefined,
      );
      maxLength(path.name, 60, { message: 'Use at most 60 characters' });
    },
    { submission: { action: () => this.save(), onInvalid: focusFirstError } },
  );
  protected readonly nameError = computed(() => this.nameForm.name().errors()[0]?.message);

  /** Anything to lose: the draft's changes, or a name typed and not stored yet. */
  protected readonly changed = computed(() => {
    const draft = this.draft();
    if (!draft) return false;
    return draftChanged(draft) || this.nameForm.name().value().trim() !== draft.name;
  });

  /** The draft's items, priced as saved ones are, in the draft's order. */
  private readonly resolutions = computed(() => {
    const draft = this.draft();
    return draft ? this.metrics.resolve(draftItems(draft)) : [];
  });
  protected readonly rows = computed(() =>
    this.resolutions().map((result) => editRow(result, this.tags.byId())),
  );

  /**
   * P5's footer: whether there are unsaved changes, and what the list costs per month on average as the draft has it,
   * before tax (§3.1's monthly equivalents), with what it can't count yet. Its "This month" comes with the charges.
   */
  protected readonly footer = computed(() => {
    const status = this.changed() ? 'Unsaved changes' : 'No unsaved changes';
    const saved = this.settings.saved();
    if (!saved) return { shown: status, spoken: status };
    const results = this.resolutions();
    const average = averageText(
      {
        resolved: results.flatMap((result) => (result.ok ? [result.resolved] : [])),
        unresolved: results.filter((result) => !result.ok),
      },
      saved,
    );
    return { shown: `${status} · ${average.shown}`, spoken: `${status}, ${average.spoken}` };
  });

  /** What the item dialog couldn't open: a plan, bundle, custom subscription or item there isn't. */
  protected readonly notice = signal<string | undefined>(undefined);

  /** What the URL asks the item dialog to open, if anything. */
  private readonly asked = computed(() => askedFor(this.params()));

  constructor() {
    if (this.listId() === undefined) void this.startNewList();
    this.destroyRef.onDestroy(() => {
      this.undo?.dismiss();
      this.itemDialog?.close();
    });

    // The prices of the regions its items were bought in, which items not saved yet need until Save.
    this.catalog.need(
      computed(() => {
        const draft = this.draft();
        return (draft ? draftItems(draft) : []).flatMap(({ region, source }) =>
          region !== undefined && source.kind !== 'custom' ? [region] : [],
        );
      }),
    );

    // A new list's tab says so; the route's title is the editor's.
    effect(() => {
      if (this.draft()?.isNew) this.title.setTitle('New list · Simply Sub');
    });

    // Another tab saved the list or dropped its changes: start again from what's stored.
    effect(() => {
      const listId = this.listId();
      if (listId === undefined) return;
      if (this.drafts.byList().has(listId)) {
        this.stored = true;
      } else if (this.stored && !this.leaving && untracked(() => this.startedDraft())) {
        this.stored = false;
        this.started.reload();
      }
    });

    // The item dialog opens once for what the URL asks, when what it needs has loaded, and the URL then drops it.
    effect(() => {
      const params = this.params();
      const asked = this.asked();
      const draft = this.draft();
      if (!asked || !draft || params === this.answered) return;
      const answer = this.answer(asked, draft);
      if (answer === undefined) return;
      this.answered = params;
      untracked(() => {
        this.notice.set(typeof answer === 'string' ? answer : undefined);
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: Object.fromEntries(dialogParams.map((name) => [name, null])),
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        if (typeof answer !== 'string') void this.openItemDialog(answer);
      });
    });

    // Focus moves once the rows show the change it waited for.
    effect(() => {
      const pending = this.pendingFocus();
      if (!pending || !pending.ready(this.rows())) return;
      this.pendingFocus.set(undefined);
      afterNextRender(() => pending.target()?.focus(), { injector: this.injector });
    });
  }

  /** Stores the name as it's typed, once it's one a list can have. */
  protected rename(value: string): void {
    const draft = this.draft();
    const name = value.trim();
    if (draft && name !== '' && name.length <= 60 && name !== draft.name) {
      void this.drafts.rename(draft.listId, name);
    }
  }

  /** Save: checks the name, then writes the list and its items at once and opens the list. */
  protected requestSave(): void {
    void submit(this.nameForm);
  }

  /** Cancel: after asking, if there's anything to lose, drops the draft and goes back. */
  protected async cancel(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.leaving) return;
    if (this.changed() && !(await this.confirmDiscard(draft))) return;
    this.leaving = true;
    await this.drafts.cancel(draft.listId);
    await this.router.navigate(draft.isNew ? ['/lists'] : ['/lists', draft.listId], {
      replaceUrl: true,
    });
  }

  /** ⋮ Delete list: after asking, deletes the list and its items, and goes to the lists. */
  protected async deleteList(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.leaving) return;
    const confirmed = await this.confirmer.confirm({
      title: `Delete ${draft.startName}?`,
      message: 'Its subscriptions are deleted with it.',
      confirmText: 'Delete list',
      danger: true,
    });
    if (!confirmed) return;
    this.leaving = true;
    await this.drafts.deleteList(draft.listId);
    await this.router.navigate(['/lists'], { replaceUrl: true });
  }

  /** 🗑: removes the item from the draft, with Undo in a snackbar, and moves focus to the next row. */
  protected async remove(row: EditRow): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    const rows = this.rows();
    const index = rows.findIndex((candidate) => candidate.id === row.id);
    const next = rows[index + 1] ?? rows[index - 1];
    await this.drafts.removeItem(draft.listId, row.id);
    this.pendingFocus.set({
      ready: (shown) => !shown.some((candidate) => candidate.id === row.id),
      target: () => (next ? this.removeButton(next.id) : this.addButton()),
    });
    this.undo = this.snackBar.open(`Removed ${row.title}`, 'Undo');
    this.undo.onAction().subscribe(() => void this.restore(draft.listId, row.id));
  }

  /** [+ Add custom subscription]'s menu: the item dialog for one of the user's custom subscriptions (flow F3). */
  protected addCustom(customSubId: string): void {
    void this.openItemDialog({ kind: 'custom', customSubId });
  }

  /** Create new…: the custom subscription editor (P12), then the item dialog for what it made. */
  protected async createCustom(): Promise<void> {
    const created = await this.customSubEditor.open();
    if (!created || this.destroyRef.destroyed) return;
    // The item dialog reads it from the repository, whose live query has it a moment after the save.
    await firstValueFrom(
      toObservable(this.customSubs.byId, { injector: this.injector }).pipe(
        filter((byId) => byId.has(created.id)),
      ),
    );
    await this.openItemDialog({ kind: 'custom', customSubId: created.id });
  }

  /** ✎: the item dialog, for the row's item. */
  protected edit(row: EditRow): void {
    const draft = this.draft();
    const item = draft && draftItems(draft).find((candidate) => candidate.id === row.id);
    if (item) void this.openItemDialog({ kind: 'item', item });
  }

  /**
   * Whether the router may leave for `url` (leaveGuard). Search in pick mode for this list keeps the draft for the
   * way back (P7, flow F2). Anywhere else the draft is dropped, after asking when there's anything to lose: a new
   * list nobody changed isn't kept either.
   */
  async canLeave(url: string): Promise<boolean> {
    const draft = this.draft();
    if (this.leaving || !draft) return true;
    const next = this.router.parseUrl(url);
    const path = next.root.children['primary']?.segments.map((segment) => segment.path).join('/');
    if (path === 'search' && next.queryParams['addTo'] === draft.listId) return true;
    if (this.changed() && !(await this.confirmDiscard(draft))) return false;
    this.leaving = true;
    await this.drafts.cancel(draft.listId);
    return true;
  }

  private confirmDiscard(draft: ListDraft): Promise<boolean> {
    return this.confirmer.confirm({
      title: 'Discard changes?',
      message: `Your changes to ${draft.startName} haven't been saved.`,
      confirmText: 'Discard changes',
      danger: true,
    });
  }

  private async save(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.leaving) return;
    this.leaving = true;
    try {
      const name = this.nameForm.name().value().trim();
      if (name !== draft.name) await this.drafts.rename(draft.listId, name);
      await this.drafts.save(draft.listId);
    } catch (error) {
      this.leaving = false;
      throw error;
    }
    await this.router.navigate(['/lists', draft.listId], { replaceUrl: true });
  }

  private async restore(listId: string, itemId: string): Promise<void> {
    await this.drafts.restoreItem(listId, itemId);
    this.pendingFocus.set({
      ready: (shown) => shown.some((candidate) => candidate.id === itemId),
      target: () => this.removeButton(itemId),
    });
  }

  /**
   * What answers what the URL asks: the dialog's request, or why there's nothing to open. Undefined while what it
   * needs is loading: the catalog, and for a custom subscription the custom subscriptions.
   */
  private answer(asked: AskedFor, draft: ListDraft): ItemDialogRequest | string | undefined {
    const catalog = this.catalog.catalog();
    if (!catalog) return undefined;
    switch (asked.kind) {
      case 'plan': {
        const { planId, interval, intervalCount, price } = asked;
        return catalog.providers.some((provider) =>
          provider.plans.some((plan) => plan.id === planId),
        )
          ? {
              kind: 'plan',
              planId,
              period: { interval, intervalCount },
              ...(price && { ownPrice: price }),
            }
          : `There’s no plan ${planId} in the catalog.`;
      }
      case 'bundle': {
        const { bundleId, interval, intervalCount } = asked;
        return catalog.bundles.some((bundle) => bundle.id === bundleId)
          ? { kind: 'bundle', bundleId, period: { interval, intervalCount } }
          : `There’s no bundle ${bundleId} in the catalog.`;
      }
      case 'custom':
        if (this.customSubs.status() !== 'ready') return undefined;
        return this.customSubs.byId().has(asked.customSubId)
          ? { kind: 'custom', customSubId: asked.customSubId }
          : 'That custom subscription doesn’t exist. It may have been deleted.';
      case 'item': {
        const item = draftItems(draft).find((candidate) => candidate.id === asked.itemId);
        return item ? { kind: 'item', item } : 'That subscription isn’t in this list.';
      }
    }
  }

  /**
   * Opens the item dialog (P6), which saves to the draft. Once it has, the snackbar says so and focus moves to the
   * item's ✎. Material's dialog and the item dialog load with the first one, outside the editor's chunk.
   */
  private async openItemDialog(request: ItemDialogRequest): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    const [{ MatDialog }, { ItemDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./item-dialog'),
    ]);
    if (this.destroyRef.destroyed) return;
    const dialog = this.injector
      .get(MatDialog)
      .open<ItemDialog, ItemDialogData, ItemDialogResult>(ItemDialog, {
        ...wideDialogConfig,
        data: { listId: draft.listId, listName: draft.name, request },
      });
    this.itemDialog = dialog;
    const result = await firstValueFrom(dialog.afterClosed());
    this.itemDialog = undefined;
    if (!result) return;
    this.snackBar.open(`${result.added ? 'Added' : 'Saved'} ${result.title}`, undefined, {
      duration: 5000,
    });
    this.pendingFocus.set({
      ready: (shown) => shown.some((candidate) => candidate.id === result.itemId),
      target: () => this.editButton(result.itemId),
    });
  }

  private editButton(itemId: string): HTMLElement | null {
    return this.host.nativeElement.querySelector(`[data-item="${itemId}"] .edit`);
  }

  private removeButton(itemId: string): HTMLElement | null {
    // Item ids are UUIDs, which need no escaping.
    return this.host.nativeElement.querySelector(`[data-item="${itemId}"] .remove`);
  }

  private addButton(): HTMLElement | null {
    return this.host.nativeElement.querySelector('.add-from-catalog');
  }

  /**
   * /lists/new (P5): a new list's draft, then its editor's URL in place of this one, keeping what Search asked to add
   * (New list…, flow F1). Nothing is saved to the lists table until Save.
   */
  private async startNewList(): Promise<void> {
    const draft = await this.drafts.startNew();
    if (this.destroyRef.destroyed) return;
    await this.router.navigate(['/lists', draft.listId, 'edit'], {
      queryParamsHandling: 'preserve',
      replaceUrl: true,
    });
  }
}

/** What the URL asks the item dialog to open, or nothing for a malformed request. */
function askedFor(params: Params): AskedFor | undefined {
  const one = (name: string): string | undefined => {
    const value: unknown = params[name];
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
  };
  const itemId = one('item');
  if (itemId !== undefined) {
    return recordIdSchema.safeParse(itemId).success ? { kind: 'item', itemId } : undefined;
  }
  const customSubId = one('addCustom');
  if (customSubId !== undefined) {
    return recordIdSchema.safeParse(customSubId).success
      ? { kind: 'custom', customSubId }
      : undefined;
  }
  return readAddRequest(params);
}
