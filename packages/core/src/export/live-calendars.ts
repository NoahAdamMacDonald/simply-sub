import type { IsoDate } from '../dates/iso-date';
import type { LiveCalendarHolds, LiveCalendarTitles } from '../user/live-calendar';
import { calendarEvents, type ExportFormat } from './calendar-events';
import type { FeedEvent } from './calendar-feed';
import type { ExportContext, ExportList } from './export-tables';

// The live calendar's calendars (PROJECT-PLAN P10, M10.3; BLUEPRINT §11.3): from every list, as the .ics download has
// them, the calendars the user chose (everything, a tag's, those with no tag), with what POST and PUT /cal take and no
// more. Amounts are as the provider charges them, so new exchange rates never change a feed, and names and titles are
// cut to the feed's limits. The app hashes each event's UID before it sends them, so no record id leaves the device.

/** The live calendar's choices. */
export interface LiveCalendarChoices {
  holds: readonly LiveCalendarHolds[];
  titles: LiveCalendarTitles;
  listNames: boolean;
}

/** A calendar to send, but for its events' UIDs, which are still the app's own. */
export interface LiveCalendarDraft {
  holds: LiveCalendarHolds;
  name: string;
  /** A tag's colour. */
  color?: string;
  events: FeedEvent[];
}

/** The longest name and title a feed takes (core's calendarFeedSchema). */
const nameLength = 60;
const titleLength = 120;

/**
 * The calendars `choices` asks for, from every list in `lists` (M10.3): everything; a tag's, holding the payments of
 * items with that tag; and the payments of items with no tag left (a deleted tag doesn't count). A tag that's gone has
 * no calendar, so the next update revokes it.
 */
export function liveCalendars(
  lists: readonly ExportList[],
  context: ExportContext,
  format: ExportFormat,
  choices: LiveCalendarChoices,
): LiveCalendarDraft[] {
  const options = {
    amounts: 'charged',
    titles: choices.titles,
    listNames: choices.listNames,
    runsFrom: 'anchor',
  } as const;
  return choices.holds.flatMap((holds): LiveCalendarDraft[] => {
    const tag = holds === 'all' || holds === 'untagged' ? undefined : context.tags.get(holds);
    if (holds !== 'all' && holds !== 'untagged' && tag === undefined) return [];
    const holding = lists.map((list) => ({
      ...list,
      resolved: list.resolved.filter((resolved) => {
        const tags = resolved.item.tagIds.filter((id) => context.tags.has(id));
        return holds === 'all' || (holds === 'untagged' ? tags.length === 0 : tags.includes(holds));
      }),
    }));
    return [
      {
        holds,
        name: oneLine(
          tag ? `Simply Sub: ${tag.name}` : holds === 'all' ? 'Simply Sub' : 'Simply Sub: No tag',
          nameLength,
        ),
        ...(tag && { color: tag.color }),
        events: calendarEvents(holding, context, format, options).map((event) => ({
          uid: event.uid,
          date: isoDate(event.start),
          title: oneLine(event.title, titleLength),
          ...(event.recurrenceRule !== undefined && { rule: event.recurrenceRule }),
        })),
      },
    ];
  });
}

/**
 * `text` on one line, its runs of spaces and line breaks one space, and cut to `length` with an ellipsis, never between
 * the two halves of a character.
 */
function oneLine(text: string, length: number): string {
  const line = text.replace(/[\s\p{Cc}]+/gu, ' ').trim();
  if (line.length <= length) return line;
  let cut = line.slice(0, length - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function isoDate([year, month, day]: readonly number[]): IsoDate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
