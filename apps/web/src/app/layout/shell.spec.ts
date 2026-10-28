import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestKey } from '@angular/cdk/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSidenavHarness } from '@angular/material/sidenav/testing';
import { Router, provideRouter } from '@angular/router';
import { routes } from '../app.routes';
import { DRAWER_BREAKPOINT, Shell } from './shell';

/** The sidebar links in wireframe order (PROJECT-PLAN P1), with the page each one opens. */
const SIDEBAR_LINKS = [
  { name: 'Home', url: '/', heading: 'Home' },
  { name: 'Lists', url: '/lists', heading: 'Subscription Lists' },
  { name: 'Payment', url: '/payment', heading: 'Payment cards' },
  { name: 'Features', url: '/features', heading: 'Your feature ranks' },
  { name: 'Calendar', url: '/calendar', heading: 'Calendar' },
  { name: 'Search', url: '/search', heading: 'Search' },
  { name: 'Settings', url: '/settings', heading: 'Settings' },
];

/** A media query list whose answer is fixed: narrow (under 960 px) or not. */
function fakeMediaQuery(query: string, narrow: boolean): MediaQueryList {
  return {
    matches: narrow && query === DRAWER_BREAKPOINT,
    media: query,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

/** A link's accessible name: its aria-label, or else its text. */
function accessibleName(link: Element): string {
  return link.getAttribute('aria-label') ?? link.textContent?.trim() ?? '';
}

describe('Shell', () => {
  async function setup({ url, narrow = false }: { url: string; narrow?: boolean }) {
    vi.stubGlobal('matchMedia', (query: string) => fakeMediaQuery(query, narrow));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        // jsdom fires no transitionend, so the drawer mustn't wait for one.
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const fixture = TestBed.createComponent(Shell);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const nav = element.querySelector<HTMLElement>('nav[aria-label="Main"]')!;
    const link = (name: string) =>
      [...nav.querySelectorAll<HTMLAnchorElement>('a')].find((a) => accessibleName(a) === name)!;
    const currentLinks = () =>
      [...nav.querySelectorAll('[aria-current="page"]')].map((a) => accessibleName(a));
    const heading = () => element.querySelector('main h1')?.textContent;

    return { fixture, router, element, link, currentLinks, heading };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on a wide screen', () => {
    it('routes every sidebar link to its page and marks only that link as current', async () => {
      const { fixture, router, link, currentLinks, heading } = await setup({ url: '/nowhere' });
      expect(currentLinks()).toEqual([]);

      for (const { name, url, heading: pageHeading } of SIDEBAR_LINKS) {
        link(name).click();
        await fixture.whenStable();

        expect(router.url).toBe(url);
        expect(heading()).toBe(pageHeading);
        expect(currentLinks()).toEqual([name]);
      }
    });

    it('keeps Lists current on the pages inside a list', async () => {
      const { currentLinks } = await setup({ url: '/lists/abc/optimize' });
      expect(currentLinks()).toEqual(['Lists']);
    });

    it('shows the sidebar beside the content, with no top bar', async () => {
      const { element } = await setup({ url: '/' });
      const sidenav = element.querySelector('mat-sidenav')!;

      expect(sidenav.classList).toContain('mat-drawer-side');
      expect(sidenav.classList).toContain('mat-drawer-opened');
      expect(element.querySelector('button[aria-label="Menu"]')).toBeNull();
    });

    it('has the settings link and the theme toggle in the sidebar footer', async () => {
      const { element } = await setup({ url: '/' });
      const footer = element.querySelector('nav .footer')!;

      expect(footer.querySelector('a[aria-label="Settings"]')?.getAttribute('href')).toBe(
        '/settings',
      );
      expect(footer.querySelector('ss-theme-toggle button')).toBeTruthy();
    });

    it('moves focus to the main content from the skip link, without navigating', async () => {
      const { fixture, router, element } = await setup({ url: '/lists' });
      const skipLink = [...element.querySelectorAll('a')].find(
        (a) => a.textContent?.trim() === 'Skip to main content',
      )!;
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      skipLink.dispatchEvent(click);
      await fixture.whenStable();

      expect(click.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(element.querySelector('main'));
      expect(router.url).toBe('/lists');
    });
  });

  describe('on a narrow screen', () => {
    async function setupNarrow(url: string) {
      const page = await setup({ url, narrow: true });
      const menuButton = page.element.querySelector<HTMLButtonElement>(
        'header button[aria-label="Menu"]',
      )!;
      const sidenav = page.element.querySelector('mat-sidenav')!;
      return { ...page, menuButton, sidenav };
    }

    it('starts with the drawer closed and opens it from ☰', async () => {
      const { fixture, menuButton, sidenav } = await setupNarrow('/');
      expect(sidenav.classList).toContain('mat-drawer-over');
      expect(sidenav.classList).not.toContain('mat-drawer-opened');
      expect(menuButton.getAttribute('aria-expanded')).toBe('false');
      expect(menuButton.getAttribute('aria-controls')).toBe(sidenav.id);

      menuButton.click();
      await fixture.whenStable();

      expect(sidenav.classList).toContain('mat-drawer-opened');
      expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    });

    it('closes the drawer on navigation and returns focus to ☰', async () => {
      const { fixture, router, link, heading, menuButton, sidenav } = await setupNarrow('/');
      menuButton.click();
      await fixture.whenStable();

      link('Calendar').click();
      await fixture.whenStable();

      expect(router.url).toBe('/calendar');
      expect(heading()).toBe('Calendar');
      expect(sidenav.classList).not.toContain('mat-drawer-opened');
      expect(menuButton.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(menuButton);
    });

    it("also closes the drawer for a link to the page that's already open", async () => {
      const { fixture, link, menuButton, sidenav } = await setupNarrow('/lists');
      menuButton.click();
      await fixture.whenStable();

      link('Lists').click();
      await fixture.whenStable();

      expect(sidenav.classList).not.toContain('mat-drawer-opened');
      expect(document.activeElement).toBe(menuButton);
    });

    it('keeps ☰ in sync when Escape closes the drawer', async () => {
      const { fixture, menuButton } = await setupNarrow('/');
      const drawer = await TestbedHarnessEnvironment.loader(fixture).getHarness(MatSidenavHarness);
      menuButton.click();
      await fixture.whenStable();

      await (await drawer.host()).sendKeys(TestKey.ESCAPE);
      await fixture.whenStable();

      expect(await drawer.isOpen()).toBe(false);
      expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    });
  });
});
