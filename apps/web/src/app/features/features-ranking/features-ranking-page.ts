import { Component, computed, inject, signal } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import {
  filterRanking,
  keyUsage,
  rankingSections,
  type RankingEntry,
  type ResolvedItem,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { MetricsService } from '../../core/metrics/metrics-service';
import { ItemsRepository } from '../../core/storage/items-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { PageHeader } from '../../shared/page-header/page-header';
import { rankNames } from '../../shared/rank/rank-text';
import { RankingCard, type RankChange } from './ranking-card';

/**
 * Features (PROJECT-PLAN P9, M6.2): the profile's rank for every rank key in the registry, which every list uses
 * unless a subscription overrides it. A card per feature category (ss-ranking-card). The categories the user's lists
 * use start open, and all of them before there's anything in a list. Changes save at once; Not ranked deletes the
 * record. "Find a feature" and Ranked only filter the rows, and Reset all clears every rank after asking.
 */
@Component({
  selector: 'ss-features-ranking-page',
  imports: [
    EmptyState,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatPrefix,
    MatSuffix,
    PageHeader,
    RankingCard,
  ],
  templateUrl: './features-ranking-page.html',
  styleUrl: './features-ranking-page.scss',
})
export class FeaturesRankingPage {
  private readonly catalog = inject(CatalogStore);
  private readonly rankings = inject(RankingsRepository);
  private readonly items = inject(ItemsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly confirm = inject(ConfirmService);

  protected readonly text = signal('');
  protected readonly rankedOnly = signal(false);
  /** What the last Set all or Reset all did, for screen readers: those rows may be off screen. */
  protected readonly announcement = signal('');

  protected readonly ranks = this.rankings.ranks;
  /** Every card, or undefined until the catalog and the ranks have loaded. */
  private readonly sections = computed(() => {
    const data = this.catalog.catalog();
    if (!data || this.rankings.status() === 'loading') return undefined;
    return rankingSections(data.features, data.categories.feature);
  });
  protected readonly filtering = computed(() => this.text().trim() !== '' || this.rankedOnly());
  protected readonly shown = computed(() => {
    const sections = this.sections();
    return (
      sections &&
      filterRanking(sections, {
        text: this.text(),
        rankedOnly: this.rankedOnly(),
        ranks: this.ranks(),
      })
    );
  });
  protected readonly usage = computed(() =>
    keyUsage(
      [...this.metrics.resolutions().values()].flatMap((resolution): ResolvedItem[] =>
        resolution.ok ? [resolution.resolved] : [],
      ),
    ),
  );
  /** How many rank keys a search or Ranked only shows, for screen readers. */
  protected readonly matches = computed(() => {
    const sections = this.shown();
    if (!sections || !this.filtering()) return '';
    const rows = (entries: readonly RankingEntry[]): number =>
      entries.reduce((total, entry) => total + entry.rows.length + rows(entry.children), 0);
    const count = sections.reduce((total, section) => total + rows(section.entries), 0);
    return count === 1 ? '1 feature' : `${count} features`;
  });
  /** Before there's anything in a list, every card starts open. */
  private readonly noItems = computed(
    () => this.items.status() === 'ready' && this.items.records().length === 0,
  );

  protected startOpen(keys: readonly string[]): boolean {
    const usage = this.usage();
    return this.noItems() || keys.some((key) => usage.has(key));
  }

  protected async change({ keys, rank }: RankChange): Promise<void> {
    if (keys.length === 1) {
      await (rank ? this.rankings.set(keys[0], rank) : this.rankings.clear(keys[0]));
      return;
    }
    await this.rankings.setMany(new Map(keys.map((key) => [key, rank])));
    const count = keys.length;
    this.announcement.set(`${count} features set to ${rank ? rankNames[rank] : 'Not ranked'}.`);
  }

  protected async resetAll(): Promise<void> {
    const ranked = [...this.ranks().keys()];
    const confirmed = await this.confirm.confirm({
      title: 'Reset all ranks?',
      message: `Your ${ranked.length === 1 ? 'rank' : `${ranked.length} ranks`} go back to Not ranked. Ranks set for one subscription stay.`,
      confirmText: 'Reset all',
      danger: true,
    });
    if (!confirmed) return;
    await this.rankings.setMany(new Map(ranked.map((key) => [key, undefined])));
    this.announcement.set('Every feature is Not ranked again.');
  }

  protected clearText(box: HTMLInputElement): void {
    this.text.set('');
    box.focus();
  }
}
