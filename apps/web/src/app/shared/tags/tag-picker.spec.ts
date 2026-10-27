import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatChipGridHarness } from '@angular/material/chips/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { tagColorPresets } from '@simply-sub/core';
import { testStorage, until, type TestStorage } from '../../core/storage/storage.testing';
import { TagsRepository } from '../../core/storage/tags-repository';
import { TagPicker } from './tag-picker';

@Component({
  imports: [TagPicker],
  template: `<ss-tag-picker [(tagIds)]="tagIds" />`,
})
class Host {
  readonly tagIds = signal<readonly string[]>([]);
}

describe('TagPicker', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<Host>;
  let loader: HarnessLoader;
  let tags: TagsRepository;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    tags = TestBed.inject(TagsRepository);
    await until(() => tags.status() === 'ready');
    fixture = TestBed.createComponent(Host);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  async function addTag(name: string, color: string) {
    const tag = await tags.create({ name, color });
    await until(() => tags.byId().has(tag.id));
    return tag;
  }

  const element = () => fixture.nativeElement as HTMLElement;
  /** The suggestions' text, without the "add" icon's ligature. */
  const suggestions = async (input: MatAutocompleteHarness) =>
    Promise.all(
      (await input.getOptions()).map(async (option) =>
        (await option.getText()).replace(/^add/, ''),
      ),
    );
  const chipNames = async () => {
    const grid = await loader.getHarness(MatChipGridHarness);
    return Promise.all((await grid.getRows()).map(async (row) => (await row.getText()).trim()));
  };

  it('picks an existing tag from the suggestions, and leaves it out of them after', async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    await addTag('Work', tagColorPresets[1].color);
    const input = await loader.getHarness(MatAutocompleteHarness);
    await input.enterText('fam');
    expect(await suggestions(input)).toEqual(['Family', 'Create tag “fam”']);
    await input.selectOption({ text: 'Family' });
    expect(fixture.componentInstance.tagIds()).toEqual([family.id]);
    expect(await chipNames()).toEqual(['Family']);
    expect(await input.getValue()).toBe('');

    await input.enterText('a');
    expect(await suggestions(input)).toEqual(['Create tag “a”']);
  });

  it('gives its input a row of the grid while the chips make one, as a grid holds only rows', async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    const roles = () => {
      const grid = element().querySelector('mat-chip-grid');
      const row = element().querySelector('.input-row');
      return [
        grid?.getAttribute('role'),
        row?.getAttribute('role'),
        row?.firstElementChild?.getAttribute('role'),
      ];
    };
    // Material's grid has no role with no chips and nothing typed.
    expect(roles()).toEqual([null, null, null]);

    fixture.componentInstance.tagIds.set([family.id]);
    await fixture.whenStable();
    expect(roles()).toEqual(['grid', 'row', 'gridcell']);
  });

  it("doesn't offer to create a tag that exists, whatever its case", async () => {
    await addTag('Family', tagColorPresets[0].color);
    const input = await loader.getHarness(MatAutocompleteHarness);
    await input.enterText('family ');
    expect(await suggestions(input)).toEqual(['Family']);
  });

  it('creates a tag with a name and a colour, saves it and picks it', async () => {
    await addTag('Family', tagColorPresets[0].color);
    const input = await loader.getHarness(MatAutocompleteHarness);
    await input.enterText('Gym');
    await input.selectOption({ text: /Create tag “Gym”/ });
    await fixture.whenStable();

    const name = element().querySelector<HTMLInputElement>('.create input[matInput]');
    expect(name?.value).toBe('Gym');
    expect(document.activeElement).toBe(name);
    // The first colour no tag has yet starts chosen.
    const checked = element().querySelector<HTMLInputElement>('.colours input:checked');
    expect(checked?.value).toBe(tagColorPresets[1].color);
    expect(checked?.closest('label')?.textContent?.trim()).toBe(tagColorPresets[1].name);

    const teal = tagColorPresets.find((preset) => preset.name === 'Teal');
    element().querySelector<HTMLInputElement>(`.colours input[value="${teal?.color}"]`)?.click();
    (
      Array.from(element().querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Create tag'),
      ) as HTMLButtonElement
    ).click();
    await until(() => tags.records().length === 2);
    await fixture.whenStable();

    const gym = tags.records().find((tag) => tag.name === 'Gym');
    expect(gym?.color).toBe(teal?.color);
    expect(fixture.componentInstance.tagIds()).toEqual([gym?.id]);
    expect(element().querySelector('.create')).toBeNull();
    expect(document.activeElement).toBe(element().querySelector('mat-chip-grid input'));
  });

  it('cancels creating with Escape, saving nothing', async () => {
    const input = await loader.getHarness(MatAutocompleteHarness);
    await input.enterText('Gym');
    await input.selectOption({ text: /Create tag “Gym”/ });
    await fixture.whenStable();
    const name = element().querySelector<HTMLInputElement>('.create input[matInput]');
    name?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(element().querySelector('.create')).toBeNull();
    expect(tags.records()).toEqual([]);
    expect(fixture.componentInstance.tagIds()).toEqual([]);
  });

  it('removes a tag with its chip’s remove button', async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    fixture.componentInstance.tagIds.set([family.id]);
    await fixture.whenStable();
    const grid = await loader.getHarness(MatChipGridHarness);
    const [row] = await grid.getRows();
    await row.remove();
    expect(fixture.componentInstance.tagIds()).toEqual([]);
  });
});
