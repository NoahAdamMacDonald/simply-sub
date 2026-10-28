import { Location } from '@angular/common';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { PageHeader } from './page-header';

@Component({
  imports: [PageHeader],
  template: `<ss-page-header
    heading="Edit list"
    [backLink]="backLink()"
    [backLabel]="backLabel()"
    [backInHistory]="inHistory()"
  >
    <button type="button">Save</button>
    <p subtitle>3 subscriptions</p>
  </ss-page-header>`,
})
class Host {
  readonly backLink = signal<string | readonly unknown[] | undefined>(undefined);
  readonly backLabel = signal('Back');
  readonly inHistory = signal(false);
}

describe('PageHeader', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'settings', children: [] },
          { path: 'lists/:listId', children: [] },
        ]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  const query = <T extends Element = HTMLElement>(selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  /** An element's words, without its icon's ligature. */
  const words = (element: Element | null) => element?.textContent?.replace('arrow_back', '').trim();

  it('shows the title, its actions and the line under it, with no back button without a link', () => {
    expect(query('h1')?.textContent).toBe('Edit list');
    expect(query('.row .actions button')?.textContent).toBe('Save');
    expect(query('.row + p[subtitle]')?.textContent).toBe('3 subscriptions');
    expect(query('.back')).toBeNull();
  });

  it('links back to the page given, by its name, above the title', async () => {
    host.backLink.set(['/lists', 'work']);
    host.backLabel.set('Work Related');
    await fixture.whenStable();

    const back = query<HTMLAnchorElement>('a.back');
    expect(back?.getAttribute('href')).toBe('/lists/work');
    expect(words(back)).toBe('Work Related');
    // First, so it's the page's first tab stop after the shell's.
    expect(back?.nextElementSibling?.classList.contains('row')).toBe(true);
  });

  it('goes back where the user came from, or to its link when the page was the first opened', async () => {
    const router = TestBed.inject(Router);
    const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => undefined);
    const navigate = vi.spyOn(router, 'navigate');
    host.backLink.set(['/lists', 'work']);
    host.inHistory.set(true);
    await fixture.whenStable();

    const button = query<HTMLButtonElement>('button.back');
    expect(words(button)).toBe('Back');
    expect(query('a.back')).toBeNull();

    // The first page opened: its link.
    button?.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/lists', 'work']);
    expect(back).not.toHaveBeenCalled();

    // After another of the app's pages: back to it.
    await router.navigateByUrl('/settings');
    navigate.mockClear();
    button?.click();
    expect(back).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});
