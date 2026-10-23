import { CurrencyPipe } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { loadPreviewCatalog } from './catalog-preview-data';
import { bundleCard, previewContext, providerCard } from './catalog-preview-view';

/**
 * TEMPORARY: lists the hand-written catalog files with a price-list switch per provider, so the data can be
 * checked in the running app. Remove it when work on Home (P2, M7.3) begins (see catalog-preview-data.ts).
 */
@Component({
  selector: 'ss-catalog-preview',
  imports: [CurrencyPipe],
  templateUrl: './catalog-preview.html',
  styleUrl: './catalog-preview.scss',
})
export class CatalogPreview {
  private readonly catalog = loadPreviewCatalog();
  private readonly context = previewContext(this.catalog);
  /** The price list picked on each provider card, by file name. Cards without a pick show their default. */
  private readonly chosen = signal<Record<string, string>>({});

  protected readonly registryIssues = [this.catalog.features, this.catalog.categories].filter(
    (file) => file.issues.length > 0,
  );
  protected readonly providers = computed(() =>
    this.catalog.providers.map((file) =>
      providerCard(file, this.chosen()[file.file], this.context),
    ),
  );
  protected readonly bundles = this.catalog.bundles.map((file) => bundleCard(file, this.context));

  protected choose(file: string, list: string): void {
    this.chosen.update((chosen) => ({ ...chosen, [file]: list }));
  }
}
