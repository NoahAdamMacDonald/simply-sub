import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { searchStores } from '../../shared/sub-card/search.testing';
import { ListEditPage } from './list-edit-page';

// The placeholder editor says what Search's Add to list asked it to add (M5.4), from Search's catalog
// (search.testing.ts): Netflix Standard, and the Netflix and Crave bundle.

describe('ListEditPage', () => {
  async function open(url: string): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [
        ...searchStores(),
        provideRouter([
          { path: 'lists/new', component: ListEditPage },
          { path: 'lists/:listId/edit', component: ListEditPage },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    return harness.routeNativeElement as HTMLElement;
  }

  const adding = (page: HTMLElement) => page.querySelector('.adding')?.textContent?.trim();

  it('says which plan it will add, by name, and how often it bills', async () => {
    const page = await open('/lists/list-1/edit?add=netflix.standard&interval=month');
    expect(adding(page)).toBe(
      'Netflix Standard, billed monthly, will be added here once the list editor is ready.',
    );
  });

  it('says so for a bundle and a period of several months, on a new list too', async () => {
    const page = await open('/lists/new?addBundle=bundle.netflix-crave&interval=month&count=3');
    expect(adding(page)).toBe(
      'Netflix and Crave, billed every 3 months, will be added here once the list editor is ready.',
    );
  });

  it('says nothing without a request, or with one that isn’t', async () => {
    expect(adding(await open('/lists/list-1/edit'))).toBeUndefined();
  });
});
