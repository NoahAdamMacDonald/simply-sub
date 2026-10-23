import { TestBed } from '@angular/core/testing';
import { CatalogPreview } from './catalog-preview';
import { loadPreviewCatalog } from './catalog-preview-data';

// TEMPORARY: removed with the catalog preview when Home (P2, M7.3) is built.
describe('loadPreviewCatalog', () => {
  it('parses every catalog file it lists without YAML or schema errors', () => {
    const catalog = loadPreviewCatalog();
    const files = [catalog.features, catalog.categories, ...catalog.providers, ...catalog.bundles];

    expect(
      files.filter((file) => file.issues.length).map((file) => [file.file, file.issues]),
    ).toEqual([]);
    expect(catalog.providers.map((file) => file.data?.id)).toEqual([
      'netflix',
      'disney-plus',
      'crave',
      'mullvad',
      'proton',
    ]);
  });
});

describe('CatalogPreview', () => {
  const card = (element: HTMLElement, file: string) =>
    element.querySelector<HTMLElement>(`article[aria-labelledby="preview-${file}"]`)!;
  const checkedList = (article: HTMLElement) =>
    article.querySelector<HTMLInputElement>('input:checked')?.value;

  it('opens each provider on its Canadian or CAD price list', async () => {
    const fixture = TestBed.createComponent(CatalogPreview);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(checkedList(card(element, 'netflix.yaml'))).toBe('CA · CAD');
    expect(card(element, 'netflix.yaml').textContent).toContain('CA$7.99');
    expect(checkedList(card(element, 'proton.yaml'))).toBe('GLOBAL · CAD');
    expect(card(element, 'proton.yaml').textContent).toContain('CA$6.24');
    expect(checkedList(card(element, 'mullvad.yaml'))).toBe('GLOBAL · EUR');
    expect(card(element, 'mullvad.yaml').textContent).toContain('€5.00 / month, prepaid');
  });

  it('shows a free plan as Free in every price list', async () => {
    const fixture = TestBed.createComponent(CatalogPreview);
    await fixture.whenStable();
    const proton = card(fixture.nativeElement as HTMLElement, 'proton.yaml');
    const free = [...proton.querySelectorAll('.item')].find(
      (item) => item.querySelector('h4')?.textContent?.trim() === 'Proton Free',
    );

    expect(free?.querySelector('.prices')?.textContent?.trim()).toBe('Free');
  });

  it('switches a provider to another price list and shows its wording for features', async () => {
    const fixture = TestBed.createComponent(CatalogPreview);
    await fixture.whenStable();
    const netflix = card(fixture.nativeElement as HTMLElement, 'netflix.yaml');

    netflix.querySelector<HTMLInputElement>('input[value="US · USD"]')!.click();
    await fixture.whenStable();

    expect(checkedList(netflix)).toBe('US · USD');
    expect(netflix.textContent).toContain('$8.99');
    expect(netflix.textContent).not.toContain('CA$7.99');
    expect(netflix.textContent).toContain('Netflix spatial audio: yes');
  });

  it('marks plans that a price list does not sell', async () => {
    const fixture = TestBed.createComponent(CatalogPreview);
    await fixture.whenStable();
    const disney = card(fixture.nativeElement as HTMLElement, 'disney-plus.yaml');
    const withAds = [...disney.querySelectorAll('.item')].find(
      (item) => item.querySelector('h4')?.textContent?.trim() === 'With Ads',
    );

    expect(withAds?.textContent).toContain('Not sold in this price list');
  });
});
