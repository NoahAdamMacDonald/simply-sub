import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import type { LiveCalendarChoices, LiveCalendarHolds, LiveCalendarTitles } from '@simply-sub/core';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService } from '../confirm/confirm-service';
import { dateText } from '../date-text';
import { LiveCalendarError, type LiveCalendarProblem } from './live-calendar-client';
import { LiveCalendarService } from './live-calendar-service';

/** A calendar of the set, as the dialog lists it. */
interface CalendarLinks {
  holds: LiveCalendarHolds;
  /** What it holds, in words: "Everything", a tag's name. */
  label: string;
  color?: string;
  url: string;
  webcalUrl: string;
  googleUrl: string;
}

/** What a request that didn't go through says. */
const problemText: Record<LiveCalendarProblem, string> = {
  offline: 'You’re offline. Try again when you’re back online.',
  gone: 'These links no longer work: they were revoked on another device, or went 180 days without an update.',
  busy: 'Your lists are still loading, or there were many changes just now. Try again in a minute.',
  full: 'The server can’t take more changes today. Try again tomorrow.',
  refused: 'Your lists have more payments than a live calendar takes: 2,000 in all.',
  failed: 'Something went wrong. Try again later.',
};

/**
 * The live calendar (PROJECT-PLAN P10, P13, M10.3; BLUEPRINT §11.3), from Sync calendar and Settings. Without links, it
 * says what's uploaded and who can see it, and asks which calendars (everything, each tag, the payments without one)
 * and what each payment shows; with links, each calendar's link, Copy link, Google's add page and Apple's webcal://
 * link, each app's steps, and Change calendars, New links and Revoke all. LiveCalendarService does the work.
 */
@Component({
  selector: 'ss-live-calendar-dialog',
  imports: [
    MatButton,
    MatCheckbox,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    MatRadioButton,
    MatRadioGroup,
  ],
  templateUrl: './live-calendar-dialog.html',
  styleUrl: './live-calendar-dialog.scss',
})
export class LiveCalendarDialog {
  private readonly service = inject(LiveCalendarService);
  private readonly tags = inject(TagsRepository);
  private readonly confirm = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');

  protected readonly record = this.service.record;
  protected readonly sending = this.service.sending;
  /** Choosing the calendars: until there are links, and from Change calendars. */
  protected readonly choosing = linkedSignal(() => this.record() === undefined);
  protected readonly holds = linkedSignal<readonly LiveCalendarHolds[]>(
    () => this.record()?.calendars.map((calendar) => calendar.holds) ?? ['all'],
  );
  protected readonly titles = linkedSignal<LiveCalendarTitles>(
    () => this.record()?.titles ?? 'name-amount',
  );
  protected readonly listNames = linkedSignal(() => this.record()?.listNames === true);
  /** A request the dialog made is under way. */
  protected readonly working = signal(false);
  /** What the last request the dialog made came to, or why it didn't. */
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected readonly online = signal(navigator.onLine);

  /** The tags the user has, in name order, each a calendar to choose. */
  protected readonly tagChoices = computed(() =>
    [...this.tags.records()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** The set's calendars, with their links. */
  protected readonly calendars = computed<CalendarLinks[]>(() => {
    const record = this.record();
    if (!record) return [];
    const tags = this.tags.byId();
    return record.calendars.map(({ holds, token }) => {
      const tag = holds === 'all' || holds === 'untagged' ? undefined : tags.get(holds);
      const url = `${location.origin}/api/v1/cal/${token}.ics`;
      const webcalUrl = url.replace(/^https?:/, 'webcal:');
      return {
        holds,
        label:
          holds === 'all'
            ? 'Everything'
            : holds === 'untagged'
              ? 'Payments without a tag'
              : (tag?.name ?? 'A tag you deleted'),
        ...(tag && { color: tag.color }),
        url,
        webcalUrl,
        googleUrl: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`,
      };
    });
  });

  /** How the links' updates stand. */
  protected readonly status = computed(() => {
    const record = this.record();
    if (!record) return '';
    if (record.broken) return `${problemText.gone} Make new links to start again.`;
    if (this.sending()) return 'Sending your changes…';
    if (this.service.problem() === 'offline') {
      return 'Waiting for the network: your changes go out when you’re back online.';
    }
    return `Up to date. Last sent ${dateText(record.sentAt.slice(0, 10))}.`;
  });

  constructor() {
    const online = () => this.online.set(true);
    const offline = () => this.online.set(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    });
  }

  protected has(holds: LiveCalendarHolds): boolean {
    return this.holds().includes(holds);
  }

  protected toggle(holds: LiveCalendarHolds, checked: boolean): void {
    this.holds.update((all) =>
      checked ? [...all.filter((one) => one !== holds), holds] : all.filter((one) => one !== holds),
    );
    if (checked) this.error.set('');
  }

  /** Create links, or Save changes. */
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    // Its button only says it's disabled while a request is under way or offline (disabledInteractive), so a press
    // still comes here.
    if (this.working() || !this.online()) return;
    const tagIds = new Set(this.tagChoices().map((tag) => tag.id));
    // In the order the dialog lists them.
    const holds = ['all', ...this.tagChoices().map((tag) => tag.id), 'untagged'].filter(
      (one) => this.has(one) && (one === 'all' || one === 'untagged' || tagIds.has(one)),
    );
    if (holds.length === 0) {
      this.error.set('Choose at least one calendar.');
      return;
    }
    const choices: LiveCalendarChoices = {
      holds,
      titles: this.titles(),
      listNames: this.listNames(),
    };
    const made = this.record() === undefined;
    const done = await this.run(() =>
      made ? this.service.create(choices) : this.service.change(choices),
    );
    if (done) {
      this.message.set(made ? 'Your links are ready.' : 'Saved your changes.');
      this.show(false);
    }
  }

  /** Change calendars, or Cancel back to the links. */
  protected show(choosing: boolean): void {
    this.choosing.set(choosing);
    this.error.set('');
    afterNextRender(() => this.title()?.nativeElement.focus(), { injector: this.injector });
  }

  protected async renew(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Make new links?',
      message:
        'The links you have stop working, in every calendar app that follows them. You’ll add the new ones to your apps again.',
      confirmText: 'Make new links',
      danger: true,
    });
    if (confirmed && (await this.run(() => this.service.renew()))) {
      this.message.set('Made new links. Add them to your calendar apps in place of the old ones.');
      this.show(false);
    }
  }

  protected async revoke(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Revoke your live calendar?',
      message:
        'Every link stops working, and the copy of your payments on the server is deleted. Your calendar apps keep what they last fetched until you remove those calendars.',
      confirmText: 'Revoke all',
      danger: true,
    });
    if (confirmed && (await this.run(() => this.service.revoke()))) {
      this.message.set('Revoked. The links no longer work.');
      this.show(true);
    }
  }

  protected async copy(calendar: CalendarLinks): Promise<void> {
    try {
      await navigator.clipboard.writeText(calendar.url);
      this.message.set(`Copied the link for ${calendar.label}.`);
    } catch {
      this.message.set('The link couldn’t be copied: select it and copy it yourself.');
    }
  }

  /** Runs a request the user asked for, saying why it failed if it does. Resolves with whether it went through. */
  private async run(request: () => Promise<void>): Promise<boolean> {
    this.working.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await request();
      return true;
    } catch (error) {
      this.error.set(
        error instanceof LiveCalendarError ? problemText[error.problem] : problemText.failed,
      );
      if (!(error instanceof LiveCalendarError))
        console.error('The live calendar request failed:', error);
      return false;
    } finally {
      this.working.set(false);
    }
  }
}
