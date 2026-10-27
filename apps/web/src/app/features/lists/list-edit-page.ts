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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormField, form, maxLength, submit, validate } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar, type MatSnackBarRef } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  draftChanged,
  draftItems,
  monthlyAverage,
  readAddRequest,
  type ListDraft,
  type ResolvedItem,
} from '@simply-sub/core';
import { map } from 'rxjs';
import { CatalogStore } from '../../core/catalog/catalog-store';
import type { AsksBeforeLeaving } from '../../core/leave-guard';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { PageHeader } from '../../shared/page-header/page-header';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { amountText } from '../../shared/price-tag/price-text';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { planTitle } from '../../shared/sub-card/card-text';
import { TagChip } from '../../shared/tags/tag-chip';
import { focusFirstError } from '../../shared/focus-first-error';
import { editRow, periodText, type EditRow } from './edit-rows';

/** Where focus goes once the rows have caught up with a change: the row after a removed one, or a restored one. */
interface PendingFocus {
  ready(rows: readonly EditRow[]): boolean;
  target(): HTMLElement | null | undefined;
}

/**
 * List edit (PROJECT-PLAN P5), for new and existing lists, on the list's draft (ListDraftService, M6.3): every change
 * is kept in Dexie, so a trip to Search in pick mode or a reload keeps it, and Save writes it all at once. /lists/new
 * makes a new list's draft and opens its editor in its place. Leaving with unsaved changes asks first (leaveGuard),
 * except for Search in pick mode for this list. The item dialog (M6.5) opens from ?add=, ?addBundle= and ?item=;
 * until then the page says what it will open.
 */
@Component({
  selector: 'ss-list-edit-page',
  imports: [
    EmptyState,
    FormField,
    MatButton,
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
    const resolved: ResolvedItem[] = [];
    let unpriced = 0;
    for (const result of this.resolutions()) {
      if (result.ok) resolved.push(result.resolved);
      else unpriced++;
    }
    const average = monthlyAverage(resolved, saved.currency);
    const amount = amountText(average.amount, saved.currency, saved.country);
    const notCounted = unpriced + average.leftOut;
    return {
      shown:
        `${status} · ${average.approx ? '≈ ' : ''}${amount} / mo average` +
        (notCounted > 0 ? ` (${notCounted} not counted)` : ''),
      spoken:
        `${status}, ${average.approx ? 'about ' : ''}${amount} a month on average` +
        (notCounted > 0 ? `, ${notCounted} not counted` : ''),
    };
  });

  /**
   * What the item dialog (M6.5) will open with: an item to add (?add=, ?addBundle=: Search's Add to list, flows F1,
   * F2 and F4), or one to change (?item=). Until it exists, the page says so.
   */
  protected readonly waiting = computed(() => {
    const params = this.params();
    const itemId = params['item'];
    if (typeof itemId === 'string') {
      const row = this.rows().find((candidate) => candidate.id === itemId);
      return row && `${row.title} will open here once the item dialog is ready.`;
    }
    const request = readAddRequest(params);
    if (!request) return undefined;
    const data = this.catalog.catalog();
    let name: string;
    if (request.kind === 'plan') {
      const provider = data?.providers.find((candidate) =>
        candidate.plans.some((plan) => plan.id === request.planId),
      );
      const plan = provider?.plans.find((candidate) => candidate.id === request.planId);
      name = provider && plan ? planTitle(provider.name, plan.name) : request.planId;
    } else {
      name =
        data?.bundles.find((bundle) => bundle.id === request.bundleId)?.name ?? request.bundleId;
    }
    const period = periodText(request.interval, request.intervalCount);
    return `${name}, billed ${period}, will be added here once the item dialog is ready.`;
  });

  constructor() {
    if (this.listId() === undefined) void this.startNewList();
    this.destroyRef.onDestroy(() => this.undo?.dismiss());

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
