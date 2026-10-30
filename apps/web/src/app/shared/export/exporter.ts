import { DOCUMENT, Injector, Service, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import type { ExportList } from '@simply-sub/core';
import { filter, firstValueFrom } from 'rxjs';
import { ClockService } from '../../core/clock/clock-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { dateText, monthText } from '../date-text';
import { amountText } from '../price-tag/price-text';
import { saveFile } from '../save-file';
import type {
  ExportFile,
  ExportRequest,
  ListExportFormat,
  PaymentsExportFormat,
} from './export-files';

export type { ListExportFormat, PaymentsExportFormat } from './export-files';

/**
 * The exports (BLUEPRINT §11.2, M7.5): List view's Export and the Calendar's Export to file and Sync calendar. It reads
 * the lists as their pages show them (MetricsService, with the live tags) and hands them to export-files.ts, which
 * loads with the first export, as do the libraries, each only for its format. The file downloads through save-file,
 * and "Saved <name>" says so.
 */
@Service()
export class Exporter {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly metrics = inject(MetricsService);
  private readonly lists = inject(ListsRepository);
  private readonly tags = inject(TagsRepository);
  private readonly customSubs = inject(CustomSubsRepository);
  private readonly settings = inject(SettingsStore);
  private readonly today = inject(ClockService).today;

  constructor() {
    // The snack bar says how an export went, even when a library can't load (offline): load it ahead, with the page.
    import('../snack/snack').catch(() => undefined);
  }

  /** One list's file (P4). Resolves with its name, or nothing when it couldn't be made. */
  exportList(listId: string, kind: ListExportFormat): Promise<string | undefined> {
    return this.save(
      async (request) => {
        const { listExport } = await import('./export-files');
        return listExport(request, kind, this.customSubs.byId());
      },
      [listId],
    );
  }

  /**
   * The lists' next 12 months of charges, or their workbook (P10). Resolves with the file's name, or nothing when it
   * couldn't be made. Sync calendar says it downloaded in its own dialog, so it can leave out "Saved <name>".
   */
  exportPayments(
    listIds: readonly string[],
    kind: PaymentsExportFormat,
    { announce = true } = {},
  ): Promise<string | undefined> {
    return this.save(
      async (request) => {
        const { paymentsExport } = await import('./export-files');
        return paymentsExport(request, kind);
      },
      listIds,
      announce,
    );
  }

  private async save(
    make: (request: ExportRequest) => Promise<ExportFile>,
    listIds: readonly string[],
    announce = true,
  ): Promise<string | undefined> {
    try {
      await this.loaded();
      const file = await make(this.request(listIds));
      saveFile(this.document, file.name, file.content, file.type);
      if (announce) await this.say(`Saved ${file.name}`);
      return file.name;
    } catch (error) {
      // A library's chunk that wouldn't load (offline), or a file a library couldn't write.
      console.error("The file couldn't be made:", error);
      await this.say('The file couldn’t be made. Check your connection, then try again.');
      return undefined;
    }
  }

  /**
   * Waits for the tags and custom subscriptions, which the Calendar doesn't show: this service starts loading them as
   * its page opens, so they're there by the first export.
   */
  private async loaded(): Promise<void> {
    const statuses = computed(() => [this.tags.status(), this.customSubs.status()]);
    const loaded = await firstValueFrom(
      toObservable(statuses, { injector: this.injector }).pipe(
        filter((all) => !all.includes('loading')),
      ),
    );
    if (loaded.includes('error'))
      throw new Error("The tags or custom subscriptions couldn't be read");
  }

  /** The lists named, in that order, with their items as their pages have them priced. */
  private request(listIds: readonly string[]): ExportRequest {
    const saved = this.settings.saved();
    if (!saved) throw new Error('Exports need the settings');
    const byId = this.lists.byId();
    const lists = listIds.flatMap((id): ExportList[] => {
      const list = byId.get(id);
      if (!list) return [];
      const { resolved, unresolved } = this.metrics.list(id);
      return [{ list, resolved, unresolved }];
    });
    return {
      lists,
      context: {
        today: this.today(),
        currency: saved.currency,
        place: saved,
        tags: this.tags.byId(),
      },
      format: {
        money: (amount, currency) => amountText(amount, currency, saved.country),
        date: dateText,
        month: monthText,
      },
    };
  }

  /** A snackbar, loaded with the first export's. */
  private async say(message: string): Promise<void> {
    const { openSnack, snackMillis } = await import('../snack/snack');
    openSnack(this.injector, message, undefined, { duration: snackMillis });
  }
}
