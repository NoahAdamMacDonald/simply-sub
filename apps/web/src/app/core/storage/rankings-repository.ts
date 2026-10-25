import { Service, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  softDeleted,
  withChanges,
  type ProfileRank,
  type ProfileRanking,
  type RankKey,
} from '@simply-sub/core';
import { storageStatus } from './record-repository';
import { StorageService } from './storage-service';

/** The profile's global ranks (PROJECT-PLAN §3.2), keyed by rank key. */
@Service()
export class RankingsRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({ stream: () => this.storage.watch('rankings') });

  /** Each ranked key's profile rank. A key that isn't here is not ranked. */
  readonly ranks = computed<ReadonlyMap<RankKey, ProfileRank>>(() => {
    const rankings: readonly ProfileRanking[] = this.stored.hasValue() ? this.stored.value() : [];
    return new Map(
      rankings
        .filter((ranking) => ranking.deletedAt === undefined)
        .map((ranking) => [ranking.rankKey, ranking.rank]),
    );
  });
  readonly status = computed(() => storageStatus(this.stored));

  /** Ranks a key. A stored ranking that can't be read is replaced. */
  async set(rankKey: RankKey, rank: ProfileRank): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.modify(
      'rankings',
      rankKey,
      (current) =>
        current
          ? withChanges(current, { rank, deletedAt: undefined }, now)
          : { rankKey, rank, createdAt: now, updatedAt: now },
      { invalid: 'replace' },
    );
  }

  /** Makes a key not ranked. Its ranking is soft-deleted, so a sync can pass that on; not-ranked is never stored. */
  async clear(rankKey: RankKey): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.modify('rankings', rankKey, (current) =>
      current !== undefined && current.deletedAt === undefined
        ? softDeleted(current, now)
        : undefined,
    );
  }
}
