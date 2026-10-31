import {
  dueRedirectMap,
  movedNotices,
  redirectedRecords,
  withChanges,
  withPlanNotices,
  type CatalogData,
  type IsoDate,
} from '@simply-sub/core';
import type { StorageService } from './storage-service';

/**
 * Moves the user's records to the ids the catalog's redirects point to (BLUEPRINT §4.3, M10.27): items, the profile's
 * ranks and drafts, in one transaction, with Home's notice of each plan saved items moved onto. Only the records that
 * still point at an old id are written, so once they're moved this writes nothing: CatalogStore runs it on every catalog
 * version and every day (a move on a date). In a chunk of its own, loaded only for a catalog with redirects. Returns how
 * many records it changed.
 */
export async function followRedirects(
  storage: StorageService,
  catalog: CatalogData,
  today: IsoDate,
): Promise<number> {
  const moves = dueRedirectMap(catalog, today);
  if (moves.size === 0) return 0;
  const now = storage.now();
  const engine = await storage.engine();
  return engine.transaction(['items', 'rankings', 'drafts', 'settings'], async (transaction) => {
    const changed = redirectedRecords(
      moves,
      {
        items: await transaction.getAll('items'),
        rankings: await transaction.getAll('rankings'),
        drafts: await transaction.getAll('drafts'),
      },
      now,
    );
    for (const item of changed.items) await transaction.put('items', item);
    for (const ranking of changed.rankings) await transaction.put('rankings', ranking);
    for (const draft of changed.drafts) await transaction.put('drafts', draft);
    const notices = movedNotices(changed.moved, catalog, today);
    const settings = notices.length > 0 ? await transaction.get('settings', 'settings') : undefined;
    if (settings) {
      const planNotices = withPlanNotices(settings.planNotices ?? [], notices, today);
      await transaction.put('settings', withChanges(settings, { planNotices }, now));
    }
    return changed.items.length + changed.rankings.length + changed.drafts.length;
  });
}
