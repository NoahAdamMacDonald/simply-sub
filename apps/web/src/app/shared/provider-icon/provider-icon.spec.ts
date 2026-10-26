import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ProviderIcon } from './provider-icon';

describe('ProviderIcon', () => {
  let fixture: ComponentFixture<ProviderIcon>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ProviderIcon);
    fixture.componentRef.setInput('name', 'netflix');
  });

  const element = () => fixture.nativeElement as HTMLElement;

  it('shows the icon at its size, as decoration', async () => {
    fixture.componentRef.setInput('src', 'icons/netflix.webp');
    fixture.componentRef.setInput('size', 24);
    await fixture.whenStable();
    const img = element().querySelector('img');
    expect(img?.getAttribute('src')).toBe('icons/netflix.webp');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('width')).toBe('24');
    expect(element().style.getPropertyValue('--size')).toBe('24px');
  });

  it('is never bigger than 48 px, the files being 96 px', async () => {
    fixture.componentRef.setInput('src', 'icons/netflix.webp');
    fixture.componentRef.setInput('size', 64);
    await fixture.whenStable();
    expect(element().querySelector('img')?.getAttribute('width')).toBe('48');
  });

  it("shows the name's first letter without an icon", async () => {
    await fixture.whenStable();
    expect(element().querySelector('img')).toBeNull();
    expect(element().querySelector('.letter')?.textContent?.trim()).toBe('N');
  });

  it("falls back to the letter when the file doesn't load, and tries a new file", async () => {
    fixture.componentRef.setInput('src', 'icons/missing.webp');
    await fixture.whenStable();
    element().querySelector('img')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(element().querySelector('img')).toBeNull();
    expect(element().querySelector('.letter')?.textContent?.trim()).toBe('N');

    fixture.componentRef.setInput('src', 'icons/netflix.webp');
    await fixture.whenStable();
    expect(element().querySelector('img')).not.toBeNull();
  });
});
