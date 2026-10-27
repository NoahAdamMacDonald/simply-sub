import {
  DestroyRef,
  Service,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import {
  catalogCheckDue,
  catalogFileKey,
  type CatalogCache,
  type CatalogData,
  type Timestamp,
} from '@simply-sub/core';
import { ClockService } from '../clock/clock-service';
import { oneAtATime } from '../one-at-a-time';
import { SettingsStore } from '../settings/settings-store';
import { CatalogCacheRepository } from '../storage/catalog-cache-repository';
import { ItemsRepository } from '../storage/items-repository';

/** What a check for a new catalog found (P13's [Check for updates]). */
export type CatalogCheckOutcome = 'current' | 'updated' | 'offline' | 'failed';

/** The Web Lock that lets one tab at a time check, so tabs that open together download a new version once. */
const checkLock = 'simply-sub-catalog';

/**
 * The catalog (BLUEPRINT §6.3): the static files the user's region needs, kept in Dexie so the app starts with them
 * and keeps working when the network drops. On start it shows the cached files, then checks index.json's version and
 * downloads the files that changed: the user's country's (its own, its group's or the full catalog.json), and the one
 * of every region a list item was bought in. It checks again when the regions change, when the browser is back
 * online, when a tab is shown again after an hour, and from Settings (P13).
 *
 * The files aren't merged: catalogFor(region) is the file that serves that region, which gives pickPrice and
 * availability the same answers as the full catalog. The checks and their schemas load as a chunk of their own.
 */
@Service()
export class CatalogStore {
  private readonly repository = inject(CatalogCacheRepository);
  private readonly settings = inject(SettingsStore);
  private readonly items = inject(ItemsRepository);
  private readonly clock = inject(ClockService);

  /** Files this tab downloaded. They stand in for the stored ones until the live query has them, or if saving failed. */
  private readonly downloaded = signal<ReadonlyMap<string, CatalogCache>>(new Map());
  private readonly browserOffline = signal(!navigator.onLine);
  private readonly unreachable = signal(false);
  private readonly checkingNow = signal(false);
  private readonly lastOutcome = signal<CatalogCheckOutcome | undefined>(undefined);
  /** The regions pages need besides the saved items' (need()). */
  private readonly needed = signal<ReadonlySet<Signal<readonly string[]>>>(new Set());
  private lastCheckedAt?: Timestamp;

  /** The cached files by key: the stored ones, or this tab's later downloads. */
  private readonly files = computed(() => {
    const files = new Map(this.repository.files());
    for (const [key, file] of this.downloaded()) {
      const stored = files.get(key);
      if (!stored || stored.fetchedAt < file.fetchedAt) files.set(key, file);
    }
    return files;
  });

  /**
   * The regions whose files are needed: the user's country, every region a list item was bought in, and the ones pages
   * need for items not saved yet (need()). Undefined until the settings and items have loaded, and empty before the
   * first run.
   */
  private readonly regions = computed<readonly string[] | undefined>(
    () => {
      if (this.settings.status() !== 'ready' || this.items.status() !== 'ready') return undefined;
      const country = this.settings.saved()?.country;
      if (country === undefined) return [];
      const regions = new Set([country]);
      for (const { region, source } of this.items.records()) {
        if (region !== undefined && source.kind !== 'custom') regions.add(region);
      }
      for (const needed of this.needed()) {
        for (const region of needed()) regions.add(region);
      }
      return [...regions].sort();
    },
    { equal: (a, b) => a?.join() === b?.join() },
  );

  /** The file that serves the user's country. */
  private readonly countryFile = computed(() => {
    const country = this.settings.saved()?.country;
    return country === undefined ? undefined : this.fileFor(country);
  });

  /** The catalog for the user's country. Undefined before the first run, and until a file has been downloaded. */
  readonly catalog = computed<CatalogData | undefined>(() => this.countryFile()?.snapshot.data);

  /** The catalog's version (`37f6573`) and when it was built, as an ISO timestamp. */
  readonly version = computed(() => this.countryFile()?.snapshot.meta.catalogVersion);
  readonly generatedAt = computed(() => this.countryFile()?.snapshot.meta.generatedAt);

  /** The browser is offline, or the last check couldn't reach the server. */
  readonly offline = computed(() => this.browserOffline() || this.unreachable());

  readonly checking = this.checkingNow.asReadonly();
  readonly lastCheck = this.lastOutcome.asReadonly();

  /**
   * Checks for a new catalog version now, and downloads what changed. A call while a check runs gets the check that
   * follows it, which sees any change that came in meanwhile.
   */
  readonly check = oneAtATime(() => this.run());

  constructor() {
    // A check once the settings and items have loaded, and again when the regions change: the first run, a new
    // country (📍), an item bought elsewhere, or storage moving to memory (whose repositories load again).
    effect(() => {
      if (this.regions() !== undefined) untracked(() => void this.check());
    });

    const online = () => {
      this.browserOffline.set(false);
      void this.check();
    };
    const offline = () => this.browserOffline.set(true);
    const shown = () => {
      if (
        document.visibilityState === 'visible' &&
        catalogCheckDue(this.lastCheckedAt, this.clock.now())
      ) {
        void this.check();
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', shown);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', shown);
    });
  }

  /**
   * Keeps the files of the regions `regions` gives downloaded while the caller lives: items not saved yet that were
   * bought elsewhere, a list draft's (P5) and the item dialog's (P6). Call it in an injection context, whose DestroyRef
   * lets them go.
   */
  need(regions: Signal<readonly string[]>): void {
    this.needed.update((needed) => new Set(needed).add(regions));
    inject(DestroyRef).onDestroy(() =>
      this.needed.update((needed) => new Set([...needed].filter((other) => other !== regions))),
    );
  }

  /** The catalog for a list item bought in `region`: the file that serves that region, if it's been downloaded. */
  catalogFor(region: string): CatalogData | undefined {
    return this.fileFor(region)?.snapshot.data;
  }

  /** The file that serves `region`, found with the regions of the latest file, which are the current catalog's. */
  private fileFor(region: string): CatalogCache | undefined {
    const files = [...this.files().values()];
    const latest = files.reduce<CatalogCache | undefined>(
      (newest, file) => (newest && newest.fetchedAt >= file.fetchedAt ? newest : file),
      undefined,
    );
    return latest && this.files().get(catalogFileKey(region, latest.snapshot.meta));
  }

  private async run(): Promise<CatalogCheckOutcome> {
    this.checkingNow.set(true);
    try {
      const { downloadCatalog } = await import('./catalog-download');
      const outcome = await exclusively(async () => {
        // What's stored now, which another tab may have just updated, and this tab's downloads.
        const stored = await this.repository.read().catch(() => []);
        const cached = new Map(stored.map((file) => [file.key, file]));
        for (const [key, file] of this.downloaded()) {
          const other = cached.get(key);
          if (!other || other.fetchedAt < file.fetchedAt) cached.set(key, file);
        }
        const download = await downloadCatalog(
          this.regions() ?? [],
          [...cached.values()],
          this.clock.now(),
        );
        if ('files' in download && (download.files.length > 0 || download.remove.length > 0)) {
          const { files, remove } = download;
          this.downloaded.update((before) => {
            const after = new Map(before);
            for (const key of remove) after.delete(key);
            for (const file of files) after.set(file.key, file);
            return after;
          });
          // Kept in this tab even if this fails (in-memory mode before [Continue anyway], a full disk).
          await this.repository
            .replace(files, remove)
            .catch((error: unknown) => console.error("The catalog couldn't be saved:", error));
        }
        return download.outcome;
      });
      this.unreachable.set(outcome === 'offline');
      this.lastCheckedAt = this.clock.now();
      this.lastOutcome.set(outcome);
      return outcome;
    } catch (error) {
      // The check's chunk didn't load: offline before it ever loaded.
      console.error("The catalog couldn't be checked for updates:", error);
      this.lastOutcome.set('failed');
      return 'failed';
    } finally {
      this.checkingNow.set(false);
    }
  }
}

/** Runs `task` while holding the check lock, so one tab at a time checks. Without Web Locks it just runs. */
function exclusively<T>(task: () => Promise<T>): Promise<T> {
  const locks = navigator.locks as LockManager | undefined;
  return locks ? locks.request(checkLock, task) : task();
}
