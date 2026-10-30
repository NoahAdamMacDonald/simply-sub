import { ApplicationRef, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Snack } from '../shared/snack/snack';
import { CatalogStore } from '../core/catalog/catalog-store';
import { CatalogStatus } from './catalog-status';

/** The parts of CatalogStore the banner and the toast read, set by each test. */
class FakeCatalogStore {
  readonly offline = signal(false);
  readonly version = signal<string | undefined>(undefined);
  readonly generatedAt = signal<string | undefined>(undefined);
}

describe('CatalogStatus', () => {
  let catalog: FakeCatalogStore;
  let fixture: ComponentFixture<CatalogStatus>;
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    catalog = new FakeCatalogStore();
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogStore, useValue: catalog },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    open = vi.spyOn(TestBed.inject(MatSnackBar), 'openFromComponent');
    fixture = TestBed.createComponent(CatalogStatus);
    await fixture.whenStable();
  });

  const status = () => (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');

  /** Lets the effect run and the snackbar load (Material's and the app's chunks). */
  async function settle() {
    await fixture.whenStable();
    await TestBed.inject(ApplicationRef).whenStable();
    await import('../shared/snack/snack');
    await new Promise((resolve) => setTimeout(resolve));
  }

  describe('the offline line', () => {
    it("is an empty live region while online, so it's announced when it appears", () => {
      expect(status()).not.toBeNull();
      expect(status()?.textContent?.trim()).toBe('');
    });

    it('gives the date of the catalog the app is using', async () => {
      catalog.generatedAt.set('2026-10-22T12:00:00Z');
      catalog.offline.set(true);
      await fixture.whenStable();
      expect(status()?.textContent?.trim()).toBe('wifi_off Offline — catalog from Oct 22');
    });

    it('says when there is no catalog yet', async () => {
      catalog.offline.set(true);
      await fixture.whenStable();
      expect(status()?.textContent).toContain(
        "Offline — the catalog will load when you're back online",
      );
    });
  });

  describe('the "Catalog updated" toast', () => {
    it('shows when a new version replaces the one on screen', async () => {
      catalog.version.set('1111111');
      await settle();
      expect(open).not.toHaveBeenCalled();

      catalog.version.set('2222222');
      await settle();
      expect(open).toHaveBeenCalledExactlyOnceWith(Snack, {
        data: { message: 'Catalog updated', duration: 5000 },
      });
    });

    it("doesn't show while a new country's file downloads, at the same version", async () => {
      catalog.version.set('1111111');
      await settle();
      catalog.version.set(undefined);
      await settle();
      catalog.version.set('1111111');
      await settle();
      expect(open).not.toHaveBeenCalled();
    });
  });
});
