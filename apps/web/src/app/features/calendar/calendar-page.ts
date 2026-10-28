import { BreakpointObserver } from '@angular/cdk/layout';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSelect, MatSelectTrigger } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import {
  addDays,
  addMonths,
  addMonthsToMonth,
  cardTitle,
  chargeTotal,
  hiddenLists,
  itemTitle,
  monthGrid,
  monthOf,
  monthRange,
  overLimits,
  readCalendarParams,
  weekdayOf,
  writeCalendarParams,
  type IsoDate,
  type IsoMonth,
  type ResolvedItem,
} from '@simply-sub/core';
import { map } from 'rxjs';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { BudgetBar } from '../../shared/budget-bar/budget-bar';
import { chargeAmountText, nearDateText } from '../../shared/charge-text';
import { monthText, spokenDayText } from '../../shared/date-text';
import { Exporter, type PaymentsExportFormat } from '../../shared/export/exporter';
import { PageHeader } from '../../shared/page-header/page-header';
import { amountText } from '../../shared/price-tag/price-text';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { SplitButton, type SplitButtonItem } from '../../shared/split-button/split-button';
import { calendarApps, type CalendarApp } from './calendar-apps';
import type { CalendarDay, CalendarEntry } from './calendar-entries';
import { DayPanel } from './day-panel';

/** Under this width the grid becomes an agenda (P10). */
const AGENDA = '(max-width: 599.98px)';
/** How many charges a day shows as chips before "+2 more" (P10). */
const chipCount = 3;
/** How many charges Upcoming lists. */
const upcomingCount = 5;

const weekdays = [
  ['Sun', 'Sunday'],
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
] as const;

const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, index, 1)),
  ),
);

/**
 * The Calendar (PROJECT-PLAN P10, M7.4): when each payment happens, for the lists shown, and how the month is going.
 * Its month and lists are in the URL (?month=&lists=; core's readCalendarParams), and the lists left out are
 * remembered on this device (settings.calendarHiddenLists). The bar fills with what's been paid so far against the
 * month's total, with a tick at the monthly budget; the grid has a tab stop that the arrow keys move, chips for each
 * day's charges, and a panel for the day; under 600 px an agenda by date, with the day in a bottom sheet. Upcoming
 * lists the next charges.
 */
@Component({
  selector: 'ss-calendar-page',
  imports: [
    BudgetBar,
    DayPanel,
    MatButton,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatLabel,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatOption,
    MatSelect,
    MatSelectTrigger,
    PageHeader,
    ProviderIcon,
    SplitButton,
  ],
  templateUrl: './calendar-page.html',
  styleUrl: './calendar-page.scss',
})
export class CalendarPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly metrics = inject(MetricsService);
  private readonly lists = inject(ListsRepository);
  private readonly settings = inject(SettingsStore);
  private readonly fx = inject(FxStore);
  private readonly cards = inject(CardsRepository);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly exporter = inject(Exporter);
  protected readonly today = inject(ClockService).today;

  protected readonly weekdays = weekdays;
  protected readonly calendarApps = calendarApps;
  /** Export to file (P10, M7.5): the calendar first, as the main button does. */
  protected readonly exportChoices: readonly SplitButtonItem[] = [
    { id: 'ics', label: 'Calendar (.ics)', icon: 'event' },
    { id: 'csv', label: 'Payment schedule (.csv)', icon: 'table_view' },
    { id: 'xlsx', label: 'Excel (.xlsx)', icon: 'grid_on' },
  ];
  protected readonly monthNames = monthNames;
  protected readonly agenda = toSignal(
    inject(BreakpointObserver)
      .observe(AGENDA)
      .pipe(map((state) => state.matches)),
    { requireSync: true },
  );

  private readonly params = toSignal(this.route.queryParams, { requireSync: true });
  protected readonly state = computed<'loading' | 'error' | 'ready'>(() => {
    const statuses = [this.lists.status(), this.metrics.status()];
    if (statuses.includes('error')) return 'error';
    return statuses.every((status) => status === 'ready') && this.settings.saved()
      ? 'ready'
      : 'loading';
  });
  private readonly listIds = computed(() => this.lists.records().map((list) => list.id));
  /** The URL read against the user's lists and what Settings remembers leaving out. */
  private readonly read = computed(() =>
    readCalendarParams(
      this.params(),
      this.today(),
      this.listIds(),
      this.settings.saved()?.calendarHiddenLists ?? [],
    ),
  );
  protected readonly month = computed(() => this.read().query.month);
  protected readonly shownLists = computed(() => this.read().query.lists);
  private readonly shown = computed(() => new Set(this.shownLists()));
  protected readonly listChoices = computed(() =>
    this.lists.records().map((list) => ({ id: list.id, name: list.name })),
  );
  /** "All lists", or the lists shown by name. */
  protected readonly showingText = computed(() => {
    const shown = this.shownLists();
    if (shown.length === this.listIds().length) return 'All lists';
    if (shown.length === 0) return 'No lists';
    const names = new Map(this.listChoices().map((list) => [list.id, list.name]));
    return shown.map((id) => names.get(id) ?? '').join(', ');
  });
  protected readonly years = computed(() => {
    const year = Number(this.today().slice(0, 4));
    const shown = Number(this.month().slice(0, 4));
    const from = Math.min(year - 3, shown);
    const to = Math.max(year + 5, shown);
    return Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
  });
  protected readonly title = computed(() => monthText(this.month()));
  /** The month select's choice: 0 for January. */
  protected readonly monthIndex = computed(() => Number(this.month().slice(5)) - 1);

  /** Every resolved item, by id, and each list's name: what a charge is for. */
  private readonly resolved = computed(() => {
    const byId = new Map<string, ResolvedItem>();
    for (const result of this.metrics.resolutions().values()) {
      if (result.ok) byId.set(result.resolved.item.id, result.resolved);
    }
    return byId;
  });
  private readonly listNames = computed(
    () => new Map(this.listChoices().map((list) => [list.id, list.name])),
  );
  /**
   * The shown month's days that take a card over its monthly limit (P10, M9.4; core's overLimits), by card id: every
   * list's charges count against a card, shown or not.
   */
  private readonly overLimit = computed(() => {
    const saved = this.settings.saved();
    const over = new Map<string, { days: ReadonlySet<IsoDate>; text: string }>();
    if (!saved) return over;
    const fx = this.fx.rates();
    const context = {
      today: this.today(),
      currency: saved.currency,
      place: saved,
      ...(fx && { fx }),
    };
    const cards = this.cards.records();
    for (const found of overLimits([...this.resolved().values()], cards, [this.month()], context)) {
      const card = this.cards.byId().get(found.cardId);
      if (!card) continue;
      const money = (amount: number) => amountText(amount, card.currency, saved.country);
      over.set(found.cardId, {
        days: new Set(found.days),
        text:
          `${cardTitle(card)} goes over its ${money(found.limit)} limit in ${monthText(found.month)}: ` +
          `${found.converted ? '≈ ' : ''}${money(found.posted)}`,
      });
    }
    return over;
  });
  /** The shown month's charges for the lists shown, as entries by day. */
  private readonly entries = computed(() => {
    const byDay = new Map<IsoDate, CalendarEntry[]>();
    const charges = this.metrics.charges(monthRange(this.month()), this.shown());
    const cards = this.cards.byId();
    for (const [index, charge] of charges.entries()) {
      const resolved = this.resolved().get(charge.itemId);
      if (!resolved) continue;
      const { item, name } = resolved;
      const card = cards.get(item.cardId ?? '');
      const over = card && this.overLimit().get(card.id);
      const entry: CalendarEntry = {
        key: `${charge.itemId}-${charge.date}-${charge.currency}-${index}`,
        charge,
        item,
        name: item.nickname ?? name,
        title: itemTitle(resolved),
        ...(resolved.iconUrl !== undefined && { iconUrl: resolved.iconUrl }),
        listName: this.listNames().get(charge.listId) ?? '',
        ...(card && { card: cardTitle(card) }),
        ...(over?.days.has(charge.date) && { overLimit: over.text }),
      };
      byDay.set(charge.date, [...(byDay.get(charge.date) ?? []), entry]);
    }
    return byDay;
  });
  protected readonly pricing = computed(() =>
    [...this.shown()].some((listId) =>
      this.metrics.list(listId).unresolved.some((item) => item.reason === 'pending'),
    ),
  );
  /** Subscriptions in the lists shown that can't be priced, which have no charges here. */
  protected readonly notShown = computed(() => {
    const count = [...this.shown()].reduce(
      (total, listId) =>
        total +
        this.metrics.list(listId).unresolved.filter((item) => item.reason !== 'pending').length,
      0,
    );
    if (count === 0) return undefined;
    return count === 1
      ? "1 subscription isn't shown: it can't be priced."
      : `${count} subscriptions aren't shown: they can't be priced.`;
  });

  /**
   * The bar (P10): what's been paid so far of the month's total, the whole of it for a past month and none of a future
   * one, against the monthly budget's tick; its colour compares the total with the budget.
   */
  protected readonly bar = computed(() => {
    const saved = this.settings.saved();
    const currency = saved?.currency ?? '';
    const charges = [...this.entries().values()].flat().map((entry) => entry.charge);
    const total = chargeTotal(charges, currency);
    const today = this.today();
    const month = this.month();
    const current = monthOf(today);
    const spent =
      month < current
        ? total.amount
        : month > current
          ? 0
          : chargeTotal(
              charges.filter((charge) => charge.date <= today),
              currency,
            ).amount;
    const money = (amount: number) => amountText(amount, currency, saved?.country);
    return {
      spent,
      total: total.amount,
      ...(saved?.monthlyBudget !== undefined && { budget: saved.monthlyBudget }),
      totalText: `${total.approx ? '≈ ' : ''}${money(total.amount)}`,
      totalSpoken: `${total.approx ? 'about ' : ''}${money(total.amount)}`,
    };
  });

  /** The grid's weeks: each day of the month with its chips, "+2 more", its total and what it's called. */
  protected readonly weeks = computed(() => {
    const country = this.settings.saved()?.country;
    const currency = this.settings.saved()?.currency ?? '';
    return monthGrid(this.month()).map((week) =>
      week.map(({ date, inMonth }) => {
        const entries = inMonth ? (this.entries().get(date) ?? []) : [];
        const total = chargeTotal(
          entries.map((entry) => entry.charge),
          currency,
        );
        const totalText =
          entries.length === 0
            ? ''
            : `${total.approx ? '≈ ' : ''}${amountText(total.amount, currency, country)}`;
        const count = entries.length;
        const overLimit = entries.some((entry) => entry.overLimit !== undefined);
        return {
          date,
          inMonth,
          overLimit,
          number: Number(date.slice(8)),
          chips: entries.slice(0, chipCount).map((entry) => ({
            key: entry.key,
            name: entry.name,
            iconUrl: entry.iconUrl,
            amount: `${entry.charge.converted ? '≈' : ''}${shortAmount(entry.charge.amount, country)}`,
            manual: entry.charge.manual,
          })),
          more: Math.max(0, count - chipCount),
          total: totalText,
          label:
            (count === 0
              ? spokenDayText(date)
              : `${spokenDayText(date)}, ${count === 1 ? '1 payment' : `${count} payments`}, ${totalText.replace('≈ ', 'about ')}`) +
            (overLimit ? ', over a card’s limit' : ''),
        };
      }),
    );
  });

  /** The agenda (under 600 px): the month's days that have charges, in order. */
  protected readonly agendaDays = computed(() => {
    const country = this.settings.saved()?.country;
    return [...this.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, entries]) => ({
        date,
        heading: spokenDayText(date),
        entries: entries.map((entry) => ({
          ...entry,
          amount: chargeAmountText({ ...entry.charge, tax: 0 }, country),
        })),
      }));
  });

  /** Upcoming (P10): the next charges from today for the lists shown. */
  protected readonly upcoming = computed(() => {
    const today = this.today();
    const country = this.settings.saved()?.country;
    return this.metrics
      .charges({ from: today, to: addMonths(today, 12) }, this.shown())
      .slice(0, upcomingCount)
      .map((charge, index) => {
        const resolved = this.resolved().get(charge.itemId);
        return {
          key: `${charge.itemId}-${charge.date}-${index}`,
          date: nearDateText(charge.date, today),
          name: resolved?.item.nickname ?? resolved?.name ?? '',
          amount: chargeAmountText({ ...charge, tax: 0 }, country),
          manual: charge.manual,
        };
      });
  });

  /** The day the panel shows (from 600 px), and the charge it was opened on. */
  private readonly selected = signal<{ date: IsoDate; key?: string } | undefined>(undefined);
  protected readonly selectedDay = computed<CalendarDay | undefined>(() => {
    const selected = this.selected();
    if (!selected || monthOf(selected.date) !== this.month() || this.agenda()) return undefined;
    return { date: selected.date, entries: this.entries().get(selected.date) ?? [] };
  });
  protected readonly selectedKey = computed(() => this.selected()?.key);

  /** The grid's one tab stop: the day last moved to, else today, else the 1st. */
  protected readonly focusDay = linkedSignal<IsoMonth, IsoDate>({
    source: this.month,
    computation: (month, previous) => {
      if (previous && monthOf(previous.value) === month) return previous.value;
      const today = this.today();
      return monthOf(today) === month ? today : `${month}-01`;
    },
  });
  /** A day the arrow keys moved to in another month: it takes focus once the grid shows it. */
  private readonly pendingFocus = signal<IsoDate | undefined>(undefined);

  constructor() {
    // A URL with what the Calendar doesn't take is rewritten in place, once the lists are known.
    effect(() => {
      if (this.state() !== 'ready') return;
      const { query, rewrite } = this.read();
      if (!rewrite) return;
      untracked(
        () =>
          void this.router.navigate([], {
            queryParams: writeCalendarParams(query, this.listIds()),
            replaceUrl: true,
          }),
      );
    });
    effect(() => {
      const date = this.pendingFocus();
      if (date === undefined || monthOf(date) !== this.month()) return;
      untracked(() => {
        this.pendingFocus.set(undefined);
        this.focusDay.set(date);
        afterNextRender(() => this.dayButton(date)?.focus(), { injector: this.injector });
      });
    });
  }

  /** Export to file: the lists shown, over the next 12 months. The file downloads, and a snackbar names it. */
  protected exportFile(kind: string): void {
    void this.exporter.exportPayments(this.shownLists(), kind as PaymentsExportFormat);
  }

  /**
   * Sync calendar (P10, Phase 3): the .ics for the lists shown downloads, then a dialog gives the app's import steps.
   * The dialog loads with the first.
   */
  protected async sync(app: CalendarApp): Promise<void> {
    const lists = this.shownLists();
    const download = () => this.exporter.exportPayments(lists, 'ics', { announce: false });
    const fileName = await download();
    if (fileName === undefined) return;
    const [{ MatDialog }, { SyncDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./sync-dialog'),
    ]);
    this.injector.get(MatDialog).open(SyncDialog, {
      data: { app, fileName, download },
      autoFocus: 'first-heading',
      ariaDescribedBy: 'sync-file',
      maxWidth: 'min(520px, calc(100vw - 32px))',
      width: '520px',
    });
  }

  protected step(months: number): void {
    this.go(addMonthsToMonth(this.month(), months));
  }

  protected toToday(): void {
    this.go(monthOf(this.today()));
  }

  protected setMonth(index: number): void {
    this.go(`${this.month().slice(0, 4)}-${String(index + 1).padStart(2, '0')}`);
  }

  protected setYear(year: string): void {
    this.go(`${year}-${this.month().slice(5)}`);
  }

  /** Showing: the lists in the URL, and the ones left out remembered on this device. */
  protected setLists(ids: readonly string[]): void {
    const lists = this.listIds().filter((id) => ids.includes(id));
    const hidden = hiddenLists(lists, this.listIds());
    void this.settings.update({ calendarHiddenLists: hidden.length > 0 ? hidden : undefined });
    this.go(this.month(), lists);
  }

  /** A day or one of its chips: its panel, or on a phone its bottom sheet. */
  protected openDay(date: IsoDate, event?: Event): void {
    const chip = (event?.target as Element | null)?.closest('[data-key]');
    const key = chip?.getAttribute('data-key') ?? undefined;
    if (this.agenda()) {
      void this.openSheet(date, key);
      return;
    }
    this.selected.set({ date, ...(key !== undefined && { key }) });
  }

  /** The panel closed: focus goes back to its day. */
  protected closeDay(): void {
    const date = this.selected()?.date;
    this.selected.set(undefined);
    if (date) afterNextRender(() => this.dayButton(date)?.focus(), { injector: this.injector });
  }

  /** The grid's keys, as the mini calendar's: arrows by day and week, Home and End, Page Up and Down by month. */
  protected moveFocus(event: KeyboardEvent): void {
    const date = this.focusDay();
    const weekday = weekdayOf(date);
    const moves: Partial<Record<string, () => IsoDate>> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -weekday),
      End: () => addDays(date, 6 - weekday),
      PageUp: () => addMonths(date, -1),
      PageDown: () => addMonths(date, 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const target = move();
    if (monthOf(target) === this.month()) {
      this.focusDay.set(target);
      this.dayButton(target)?.focus();
      return;
    }
    this.pendingFocus.set(target);
    this.go(monthOf(target));
  }

  private go(month: IsoMonth, lists: readonly string[] = this.shownLists()): void {
    void this.router.navigate([], {
      queryParams: writeCalendarParams({ month, lists: [...lists] }, this.listIds()),
    });
  }

  private dayButton(date: IsoDate): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`.day[data-date="${date}"]`);
  }

  /** A phone's day: a bottom sheet with its panel, which follows the page while it's open. */
  private async openSheet(date: IsoDate, key?: string): Promise<void> {
    const [{ MatBottomSheet }, { DaySheet }] = await Promise.all([
      import('@angular/material/bottom-sheet'),
      import('./day-sheet'),
    ]);
    const day = computed<CalendarDay>(() => ({ date, entries: this.entries().get(date) ?? [] }));
    this.injector.get(MatBottomSheet).open(DaySheet, {
      data: { day, ...(key !== undefined && { focusKey: key }) },
      ariaLabel: spokenDayText(date),
      // The panel puts focus on the payment it was opened on, or its heading; the sheet leaves it to it.
      autoFocus: false,
    });
  }
}

/** A chip's amount without its currency, for room: 19.94. */
function shortAmount(amount: number, country: string | undefined): string {
  return amount.toLocaleString(country === undefined ? 'en' : `en-${country}`, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
