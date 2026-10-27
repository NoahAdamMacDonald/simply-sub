import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import {
  rankChoices,
  type ProfileRank,
  type ProfileRanks,
  type Rank,
  type RankKey,
  type RankingEntry,
  type RankingSection,
} from '@simply-sub/core';
import { RankDot } from '../../shared/rank/rank-dot';
import { RankSelect } from '../../shared/rank/rank-select';
import { rankNames } from '../../shared/rank/rank-text';

/** New ranks for some keys: a rank, or undefined for not ranked. */
export interface RankChange {
  keys: readonly RankKey[];
  rank: ProfileRank | undefined;
}

/** A feature with more rows than this starts folded (Storable item types has 22), unless one of them is ranked. */
const foldAbove = 4;

let nextId = 0;

/**
 * A feature category's card on the Features page (PROJECT-PLAN P9, M6.2): its features in registry order, a parent's
 * children under it, and a dropdown per rank key. A ranked row has its rank's colour down its left edge. A parent has
 * Set all, which ranks every child key in one step; nothing cascades otherwise. The card folds, and so does a feature
 * with many rows. While a search or Ranked only is on, everything shown is a match, so it's all open.
 */
@Component({
  selector: 'ss-ranking-card',
  imports: [
    MatButton,
    MatIcon,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    NgTemplateOutlet,
    RankDot,
    RankSelect,
  ],
  templateUrl: './ranking-card.html',
  styleUrl: './ranking-card.scss',
})
export class RankingCard {
  readonly section = input.required<RankingSection>();
  readonly ranks = input.required<ProfileRanks>();
  /** How many list items provide each key. */
  readonly usage = input.required<ReadonlyMap<RankKey, number>>();
  /** Whether it starts open: the user's lists use it, or there's nothing in them yet. */
  readonly startOpen = input(false);
  /** A search or Ranked only is on. */
  readonly filtering = input(false);
  readonly rankChange = output<RankChange>();

  protected readonly id = `ss-ranking-${nextId++}`;
  protected readonly choices = rankChoices('profile');
  protected readonly names = rankNames;
  private readonly toggled = signal<boolean | undefined>(undefined);
  /** The folds the user opened or closed, by feature id. */
  private readonly folds = signal<ReadonlyMap<string, boolean>>(new Map());

  protected readonly open = computed(
    () => this.filtering() || (this.toggled() ?? this.startOpen()),
  );
  protected readonly ranked = computed(
    () => this.section().keys.filter((key) => this.ranks().has(key)).length,
  );

  protected toggle(): void {
    this.toggled.set(!this.open());
  }

  protected rank(key: RankKey): Rank {
    return this.ranks().get(key) ?? 'not-ranked';
  }

  /** A valued feature with many rows, which folds. */
  protected foldable(entry: RankingEntry): boolean {
    return !entry.single && entry.rows.length > foldAbove;
  }

  protected unfolded(entry: RankingEntry): boolean {
    if (!this.foldable(entry) || this.filtering()) return true;
    return this.folds().get(entry.id) ?? entry.rows.some((row) => this.ranks().has(row.key));
  }

  protected toggleFold(entry: RankingEntry): void {
    const open = this.unfolded(entry);
    this.folds.update((folds) => new Map(folds).set(entry.id, !open));
  }

  /** "in 3 subscriptions", when the user's lists provide the key. */
  protected usageText(key: RankKey): string | undefined {
    const count = this.usage().get(key);
    return count ? `in ${count} ${count === 1 ? 'subscription' : 'subscriptions'}` : undefined;
  }

  protected choose(key: RankKey, rank: Rank | undefined): void {
    this.rankChange.emit({ keys: [key], rank: profileRank(rank) });
  }

  protected setAll(entry: RankingEntry, rank: Rank): void {
    this.rankChange.emit({ keys: entry.childKeys, rank: profileRank(rank) });
  }
}

/** A profile dropdown's choice as stored: Not ranked is no rank (P9). */
function profileRank(rank: Rank | undefined): ProfileRank | undefined {
  return rank === undefined || rank === 'not-ranked' ? undefined : (rank as ProfileRank);
}
