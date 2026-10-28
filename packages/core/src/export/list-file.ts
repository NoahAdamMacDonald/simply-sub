import type { IsoDate } from '../dates/iso-date';
import type { CustomSubscription } from '../user/custom-subscription';
import type { ListItem } from '../user/list-item';
import type { SubscriptionList } from '../user/subscription-list';
import type { Tag } from '../user/tag';

// List view's JSON export (M7.5, the user's choice): one list and its items as they're stored, with the tags and custom
// subscriptions they name, to read or to use elsewhere. It isn't a backup: it has no schemaVersion, so Import refuses
// it as one (user/backup.ts), and only a backup restores data.

/** What the file holds. */
export interface ListFile {
  /** As a backup's: where the file comes from. */
  app: 'simply-sub';
  file: 'list';
  exportedOn: IsoDate;
  list: SubscriptionList;
  /** The list's items, naming only live tags. */
  items: ListItem[];
  /** The custom subscriptions its items are, and the live tags they name. */
  customSubs: CustomSubscription[];
  tags: Tag[];
}

/** `list` and its `items`, with the custom subscriptions and live tags they name, for List view's JSON export. */
export function listFile(
  list: SubscriptionList,
  items: readonly ListItem[],
  {
    tags,
    customSubs,
  }: {
    tags: ReadonlyMap<string, Tag>;
    customSubs: ReadonlyMap<string, CustomSubscription>;
  },
  today: IsoDate,
): ListFile {
  const kept = items.map((item) => ({ ...item, tagIds: item.tagIds.filter((id) => tags.has(id)) }));
  const tagIds = new Set(kept.flatMap((item) => item.tagIds));
  const customIds = new Set(
    kept.flatMap(({ source }) => (source.kind === 'custom' ? [source.customSubId] : [])),
  );
  return {
    app: 'simply-sub',
    file: 'list',
    exportedOn: today,
    list,
    items: kept,
    customSubs: [...customIds].flatMap((id) => customSubs.get(id) ?? []),
    tags: [...tagIds].flatMap((id) => tags.get(id) ?? []),
  };
}
