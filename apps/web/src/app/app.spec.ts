import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBKeyRange } from 'fake-indexeddb';
import { App } from './app';
import { routes } from './app.routes';
import { SettingsStore } from './core/settings/settings-store';
import { INDEXED_DB } from './core/storage/storage-service';
import { testStorage, until } from './core/storage/storage.testing';

describe('App', () => {
  function setup() {
    const fixture = TestBed.createComponent(App);
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('renders the shell: sidebar navigation and the main landmark', async () => {
    TestBed.configureTestingModule({ providers: [testStorage().providers, provideRouter(routes)] });
    const { fixture, element } = setup();
    await fixture.whenStable();

    expect(element.querySelector('ss-shell nav[aria-label="Main"]')).toBeTruthy();
    expect(element.querySelector('ss-shell main#main')).toBeTruthy();
    expect(element.textContent).not.toContain('Nothing is being saved');
  });

  describe('when IndexedDB is blocked', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const blocked = {
        open: () => {
          throw new DOMException('The user denied permission', 'SecurityError');
        },
      };
      TestBed.configureTestingModule({
        providers: [
          testStorage().providers,
          provideRouter(routes),
          { provide: INDEXED_DB, useValue: { indexedDB: blocked, IDBKeyRange } },
        ],
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('says nothing will be saved, in place of the app', async () => {
      const { fixture, element } = setup();
      await until(() => TestBed.inject(SettingsStore).status() === 'error');
      await fixture.whenStable();

      expect(element.querySelector('ss-shell')).toBeNull();
      expect(element.querySelector('main h1')?.textContent).toBe('Nothing will be saved');
      expect(element.textContent).toContain(
        'Your browser is blocking local storage, so nothing will be saved.',
      );
    });

    it('carries on in memory after [Continue anyway], and says so', async () => {
      const { fixture, element } = setup();
      await until(() => TestBed.inject(SettingsStore).status() === 'error');
      await fixture.whenStable();

      const button = [...element.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Continue anyway',
      );
      button!.click();
      await until(() => TestBed.inject(SettingsStore).status() === 'ready');
      await fixture.whenStable();

      expect(element.querySelector('ss-shell main#main')).toBeTruthy();
      expect(element.textContent).toContain(
        'Nothing is being saved: your browser is blocking local storage.',
      );
      // The first-run dialog asks next, for this tab only.
      expect(TestBed.inject(SettingsStore).needsFirstRun()).toBe(true);
    });
  });
});
