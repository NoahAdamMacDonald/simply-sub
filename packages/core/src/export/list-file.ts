import type { IsoDate } from '../dates/iso-date';
import type { CustomSubscription } from '../user/custom-subscription';
import type { ListItem } from '../user/list-item';
import type { SubscriptionList } from '../user/subscription-list';
import type { Tag } from '../user/tag';

// List view's JSON export (M7.5, the user's choice): one list and its items as they're stored, with the tags and custom
// subscriptions they name, to read or to use elsewhere. It isn't a backup: it has no schemaVersion, so Import refuses
// it as one (user/backup.ts), and only a backup restores data. An account's balance is in it only when the user ticks
// Include balances, and its facts never are (M11.11).

/** What the file holds. */
export interface ListFile {
  /** As a backup's: where the file comes from. */
  app: 'simply-sub';
  file: 'list';
  exportedOn: IsoDate;
  list: SubscriptionList;
  /** The list's items, naming only live tags, an account's balance only with Include balances. */
  items: ListItem[];
  /** The custom subscriptions its items are, and the live tags they name. */
  customSubs: CustomSubscription[];
  tags: Tag[];
}

/**
 * `list` and its `items`, with the custom subscriptions and live tags they name, for List view's JSON export. An
 * account's balance and its date stay only with `includeBalances`.
 */
export function listFile(
  list: SubscriptionList,
  items: readonly ListItem[],
  {
    tags,
    customSubs,
    includeBalances = false,
  }: {
    tags: ReadonlyMap<string, Tag>;
    customSubs: ReadonlyMap<string, CustomSubscription>;
    includeBalances?: boolean;
  },
  today: IsoDate,
): ListFile {
  const kept = items.map(({ account, ...item }) => ({
    ...item,
    tagIds: item.tagIds.filter((id) => tags.has(id)),
    ...(includeBalances &&
      account && { account: { balance: account.balance, asOf: account.asOf } }),
  }));
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
