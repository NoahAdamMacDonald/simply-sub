import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { testStorage, until } from './core/storage/storage.testing';

/**
 * Every route in BLUEPRINT §8.2, with the page heading and the tab title it should show. /lists/new moves on to the
 * new list's editor, which has a test of its own.
 */
const PAGES = [
  { url: '/', heading: 'Home', title: 'Home · Simply Sub' },
  { url: '/lists', heading: 'Lists', title: 'Lists · Simply Sub' },
  { url: '/lists/abc', heading: 'List', title: 'List · Simply Sub' },
  { url: '/lists/abc/edit', heading: 'Edit list', title: 'Edit list · Simply Sub' },
  { url: '/lists/abc/optimize', heading: 'Optimizations', title: 'Optimizations · Simply Sub' },
  { url: '/search', heading: 'Search', title: 'Search · Simply Sub' },
  { url: '/features', heading: 'Your feature ranks', title: 'Features · Simply Sub' },
  { url: '/calendar', heading: 'Calendar', title: 'Calendar · Simply Sub' },
  { url: '/payment', heading: 'Payment', title: 'Payment · Simply Sub' },
  { url: '/custom', heading: 'Custom subscriptions', title: 'Custom subscriptions · Simply Sub' },
  { url: '/settings', heading: 'Settings', title: 'Settings · Simply Sub' },
];

describe('routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it.each(PAGES)('$url opens the $heading page', async ({ url, heading, title }) => {
    const harness = await RouterTestingHarness.create(url);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(heading);
    expect(document.title).toBe(title);
  });

  it('/lists/new makes a new list’s draft and opens its editor in its place (M6.3)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(routes), testStorage().providers] });
    const harness = await RouterTestingHarness.create('/lists/new');
    const router = TestBed.inject(Router);
    await until(() => /^\/lists\/[0-9a-f-]{36}\/edit$/.test(router.url));
    await harness.fixture.whenStable();

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Edit list');
    expect(document.title).toBe('Edit list · Simply Sub');
  });

  it('has the component gallery in development builds (dev-routes.ts)', async () => {
    const harness = await RouterTestingHarness.create('/dev/components');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Components');
    expect(document.title).toBe('Components · Simply Sub');
  });

  it('shows "Page not found" for an unknown URL, with working links to Home and Lists', async () => {
    const harness = await RouterTestingHarness.create('/no/such/page');
    const page = harness.routeNativeElement!;

    expect(page.querySelector('h1')?.textContent).toBe('Page not found');
    expect(document.title).toBe('Page not found · Simply Sub');
    const links = [...page.querySelectorAll('a')];
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Home', '/'],
      ['Lists', '/lists'],
    ]);

    links[1].click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/lists');
  });
});
