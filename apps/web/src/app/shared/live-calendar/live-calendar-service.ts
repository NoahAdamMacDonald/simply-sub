import {
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  daysBetween,
  liveCalendars,
  maxFeedEvents,
  type CalendarFeeds,
  type ExportList,
  type LiveCalendar,
  type LiveCalendarChoices,
  type LiveCalendarDraft,
} from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { oneAtATime } from '../../core/one-at-a-time';
import { SettingsStore } from '../../core/settings/settings-store';
import { ListsRepository } from '../../core/storage/lists-repository';
import { LiveCalendarRepository } from '../../core/storage/live-calendar-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { dateText, monthText } from '../date-text';
import { amountText } from '../price-tag/price-text';
import {
  LiveCalendarError,
  createFeedSet,
  replaceFeedSet,
  revokeFeedSet,
  type LiveCalendarProblem,
} from './live-calendar-client';

/** How long a change waits for the next before the feeds are sent, so a burst of edits is one update. Specs set 0. */
export const LIVE_CALENDAR_SETTLE_MS = new InjectionToken<number>('LIVE_CALENDAR_SETTLE_MS', {
  factory: () => 5_000,
});
/** The server deletes a set 180 days after its last write: the app writes at least this often while it's used. */
const refreshDays = 30;
/** One tab at a time sends the feeds. */
const sendLock = 'simply-sub:live-calendar';

/**
 * The live calendar (PROJECT-PLAN P10, P13, M10.3; BLUEPRINT §11.3): the feed set the user made, and the calls that
 * make, change, renew and revoke it. From when it's first used (the dialog, or the app once it has shown) it keeps the
 * feeds current: 5 s after a change to what they hold, when the network is back, and at least every 30 days, sending
 * them only when they changed. Their events are the lists' as the pages have them priced (core's liveCalendars), each
 * UID a hash, so no record id leaves the device. A set revoked elsewhere, or expired, is marked broken.
 */
@Service()
export class LiveCalendarService {
  private readonly repository = inject(LiveCalendarRepository);
  private readonly lists = inject(ListsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly tags = inject(TagsRepository);
  private readonly settings = inject(SettingsStore);
  private readonly clock = inject(ClockService);
  private readonly settleMs = inject(LIVE_CALENDAR_SETTLE_MS);

  /** The feed set, while there is one. */
  readonly record = this.repository.record;
  /** A request is under way. */
  readonly sending = signal(false);
  /** Why the feeds weren't sent last time, until they are. */
  readonly problem = signal<LiveCalendarProblem | undefined>(undefined);

  /** Every list as its pages have it priced. Undefined while anything is loading, so nothing half-loaded is sent. */
  private readonly exportLists = computed<ExportList[] | undefined>(() => {
    const statuses = [this.lists.status(), this.metrics.status(), this.tags.status()];
    if (statuses.some((status) => status !== 'ready') || !this.settings.saved()) return undefined;
    const byList = this.metrics.byList();
    for (const { unresolved } of byList.values()) {
      if (unresolved.some((item) => item.reason === 'pending')) return undefined;
    }
    return this.lists.records().map((list) => ({ list, ...this.metrics.list(list.id) }));
  });

  /** The calendars the stored choices make now. */
  private readonly drafts = computed(() => {
    const record = this.record();
    return record && this.calendars(choicesOf(record));
  });

  private readonly sendChanges = oneAtATime(() => this.run());
  private settling: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      if (this.drafts() !== undefined) untracked(() => this.settle(this.settleMs));
    });
    const online = () => this.settle(0);
    window.addEventListener('online', online);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', online);
      clearTimeout(this.settling);
    });
  }

  /** The calendars `choices` make from every list now; undefined while anything is still loading. */
  calendars(choices: LiveCalendarChoices): LiveCalendarDraft[] | undefined {
    const lists = this.exportLists();
    const saved = this.settings.saved();
    if (!lists || !saved) return undefined;
    return liveCalendars(
      lists,
      { today: this.clock.today(), currency: saved.currency, place: saved, tags: this.tags.byId() },
      {
        money: (amount, currency) => amountText(amount, currency, saved.country),
        date: dateText,
        month: monthText,
      },
      choices,
    );
  }

  /** Makes a feed set of the calendars `choices` ask for. Throws a LiveCalendarError when it can't. */
  async create(choices: LiveCalendarChoices): Promise<void> {
    const drafts = this.ready(choices);
    this.sending.set(true);
    try {
      const made = await createFeedSet(await feedsToSend(drafts, undefined));
      await this.repository.save({
        setId: made.id,
        manageKey: made.manageKey,
        calendars: drafts.map((draft, index) => ({
          holds: draft.holds,
          token: made.feeds[index].token,
        })),
        titles: choices.titles,
        ...(choices.listNames && { listNames: true }),
        sentHash: await sha256(JSON.stringify(drafts)),
        sentAt: this.clock.now(),
      });
      this.problem.set(undefined);
    } finally {
      this.sending.set(false);
    }
  }

  /** Changes the set's calendars to `choices`' (Change calendars): the ones kept keep their links. */
  async change(choices: LiveCalendarChoices): Promise<void> {
    const record = this.record();
    if (!record) return this.create(choices);
    await this.send(record, this.ready(choices), choices);
  }

  /** New links (P10): the set revoked and another made with the same choices, for a link shared too far. */
  async renew(): Promise<void> {
    const record = this.record();
    if (!record) return;
    const choices = choicesOf(record);
    const drafts = this.ready(choices);
    this.sending.set(true);
    try {
      await revokeFeedSet(record.setId, record.manageKey);
    } finally {
      this.sending.set(false);
    }
    await this.repository.remove();
    await this.create({ ...choices, holds: drafts.map((draft) => draft.holds) });
  }

  /** Revoke all (P10): every link stops working. Throws a LiveCalendarError when the server can't be told. */
  async revoke(): Promise<void> {
    const record = this.record();
    if (!record) return;
    this.sending.set(true);
    try {
      await revokeFeedSet(record.setId, record.manageKey);
      await this.repository.remove();
      this.problem.set(undefined);
    } finally {
      this.sending.set(false);
    }
  }

  /** Sends the feeds after `delay`, unless a later call comes first. */
  private settle(delay: number): void {
    clearTimeout(this.settling);
    this.settling = setTimeout(() => void this.sendChanges(), delay);
  }

  /**
   * Sends the feeds, from one tab at a time, when they changed since they were last sent, or that was 30 days ago. It
   * never rejects (oneAtATime): what went wrong is in `problem`.
   */
  private async run(): Promise<void> {
    const locks = navigator.locks as LockManager | undefined;
    const task = async () => {
      const record = this.record();
      const drafts = this.drafts();
      if (!record || !drafts || record.broken) return;
      const due = daysBetween(record.sentAt.slice(0, 10), this.clock.today()) >= refreshDays;
      if (!due && record.sentHash === (await sha256(JSON.stringify(drafts)))) return;
      await this.send(record, drafts, choicesOf(record));
    };
    try {
      await (locks ? locks.request(sendLock, task) : task());
    } catch (error) {
      if (error instanceof LiveCalendarError) {
        // Too many changes this minute: once more, a minute on. Offline: when the network is back.
        if (error.problem === 'busy') this.settle(60_000);
        return;
      }
      console.error("The live calendar couldn't be updated:", error);
      this.problem.set('failed');
    }
  }

  /** Replaces the set's calendars with `drafts`, keeping each one's link, and stores what was sent. */
  private async send(
    record: LiveCalendar,
    drafts: LiveCalendarDraft[],
    choices: LiveCalendarChoices,
  ): Promise<void> {
    this.sending.set(true);
    try {
      const sent = await replaceFeedSet(
        record.setId,
        record.manageKey,
        await feedsToSend(drafts, record),
      );
      await this.repository.update({
        calendars: drafts.map((draft, index) => ({
          holds: draft.holds,
          token: sent.feeds[index].token,
        })),
        titles: choices.titles,
        listNames: choices.listNames ? true : undefined,
        sentHash: await sha256(JSON.stringify(drafts)),
        sentAt: this.clock.now(),
      });
      this.problem.set(undefined);
    } catch (error) {
      if (error instanceof LiveCalendarError) {
        this.problem.set(error.problem);
        if (error.problem === 'gone') await this.repository.update({ broken: true });
      }
      throw error;
    } finally {
      this.sending.set(false);
    }
  }

  /** The calendars `choices` make, ready to send; or a LiveCalendarError saying why they can't be. */
  private ready(choices: LiveCalendarChoices): LiveCalendarDraft[] {
    const drafts = this.calendars(choices);
    // Still loading: try again in a moment.
    if (!drafts) throw new LiveCalendarError('busy');
    const events = drafts.reduce((sum, draft) => sum + draft.events.length, 0);
    if (drafts.length === 0 || events > maxFeedEvents) throw new LiveCalendarError('refused');
    return drafts;
  }
}

/** The choices a stored set was made with. */
function choicesOf(record: LiveCalendar): LiveCalendarChoices {
  return {
    holds: record.calendars.map((calendar) => calendar.holds),
    titles: record.titles,
    listNames: record.listNames === true,
  };
}

/**
 * What POST or PUT /cal takes for `drafts`: each calendar with its token when `record` has one for it, and each event's
 * UID a hash of the app's own, so no record id leaves the device.
 */
async function feedsToSend(
  drafts: readonly LiveCalendarDraft[],
  record: LiveCalendar | undefined,
): Promise<CalendarFeeds> {
  return {
    feeds: await Promise.all(
      drafts.map(async ({ holds, name, color, events }) => {
        const token = record?.calendars.find((calendar) => calendar.holds === holds)?.token;
        return {
          ...(token !== undefined && { token }),
          name,
          ...(color !== undefined && { color }),
          events: await Promise.all(
            events.map(async (event) => ({
              ...event,
              uid: (await sha256(event.uid)).slice(0, 32),
            })),
          ),
        };
      }),
    ),
  };
}

/** The SHA-256 of `text`, in hex. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
