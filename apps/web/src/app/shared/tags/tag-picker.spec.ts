import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatChipGridHarness } from '@angular/material/chips/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { tagColorPresets, type ListItem } from '@simply-sub/core';
import { ItemsRepository } from '../../core/storage/items-repository';
import { testStorage, until, type TestStorage } from '../../core/storage/storage.testing';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService, type ConfirmOptions } from '../confirm/confirm-service';
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
  let questions: ConfirmOptions[];

  beforeEach(async () => {
    storage = testStorage();
    questions = [];
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        {
          provide: ConfirmService,
          useValue: {
            confirm: async (options: ConfirmOptions) => {
              questions.push(options);
              return true;
            },
          },
        },
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

  it('closes its suggestions when focus moves on to another control, but not to what holds it', async () => {
    await addTag('Family', tagColorPresets[0].color);
    const input = await loader.getHarness(MatAutocompleteHarness);
    const box = element().querySelector<HTMLInputElement>('mat-chip-grid input')!;
    const leave = async (next: HTMLElement) => {
      box.dispatchEvent(new FocusEvent('blur', { relatedTarget: next }));
      await fixture.whenStable();
    };

    // A click on a suggestion moves focus to the dialog around the field: Material handles that.
    await input.enterText('f');
    await leave(element());
    expect(await input.isOpen()).toBe(true);

    const next = document.createElement('button');
    document.body.append(next);
    await leave(next);
    expect(await input.isOpen()).toBe(false);
    next.remove();
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

  it('takes a new tag’s colour as a hex or from the device’s picker, each following the other (M6.15)', async () => {
    const input = await loader.getHarness(MatAutocompleteHarness);
    await input.enterText('Gym');
    await input.selectOption({ text: /Create tag “Gym”/ });
    await fixture.whenStable();
    const hex = element().querySelector<HTMLInputElement>('.create .hex input')!;
    const picker = element().querySelector<HTMLInputElement>('.create ss-colour-picker input')!;
    expect(hex.value).toBe(tagColorPresets[0].color);
    expect(picker.value).toBe(tagColorPresets[0].color);

    picker.value = '#ff8800';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(hex.value).toBe('#ff8800');
    expect(element().querySelector('.colours input:checked')).toBeNull();

    hex.value = '12ab9';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(element().querySelector('.create .hint-error')?.textContent?.trim()).toBe(
      'Use six hex digits, like #1e88e5',
    );
    const createButton = Array.from(element().querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Create tag'),
    ) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    hex.value = '12AB9F';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(picker.value).toBe('#12ab9f');
    createButton.click();
    await until(() => tags.records().length === 1);
    expect(tags.records()[0].color).toBe('#12ab9f');
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

  it('removes a tag with a click anywhere on its chip, once', async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    const work = await addTag('Work', tagColorPresets[1].color);
    fixture.componentInstance.tagIds.set([family.id, work.id]);
    await fixture.whenStable();
    element().querySelector<HTMLElement>('mat-chip-row')?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.tagIds()).toEqual([work.id]);

    // The X's own click removes it once, not twice.
    element().querySelector<HTMLElement>('mat-chip-row [matChipRemove]')?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.tagIds()).toEqual([]);
  });

  describe('Delete a tag', () => {
    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
    });

    it('is there only once there are tags', async () => {
      expect(element().querySelector('.delete-tags')).toBeNull();
      await addTag('Family', tagColorPresets[0].color);
      await fixture.whenStable();
      expect(element().querySelector('.delete-tags')?.getAttribute('aria-label')).toBe(
        'Delete a tag',
      );
    });

    it("deletes one everywhere, asking first when it's in use, and takes it off the chips", async () => {
      const family = await addTag('Family', tagColorPresets[0].color);
      const work = await addTag('Work', tagColorPresets[1].color);
      const items = TestBed.inject(ItemsRepository);
      const item: Omit<ListItem, 'id' | 'createdAt' | 'updatedAt'> = {
        listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
        source: { kind: 'catalog', planId: 'netflix.standard' },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-11-12',
          autoRenew: true,
        },
        tagIds: [family.id],
        rankOverrides: {},
        pinned: false,
      };
      await items.create(item);
      fixture.componentInstance.tagIds.set([family.id, work.id]);
      await fixture.whenStable();

      const menu = await loader.getHarness(MatMenuHarness.with({ selector: '.delete-tags' }));
      await menu.open();
      const choices = await menu.getItems();
      expect(await Promise.all(choices.map(async (choice) => choice.getText()))).toEqual([
        'Family',
        'Work',
      ]);
      await choices[0].click();
      await until(() => !tags.byId().has(family.id));
      await fixture.whenStable();

      expect(questions.map((question) => question.message)).toEqual([
        'Used by 1 subscription. It comes off them in every list.',
      ]);
      expect(fixture.componentInstance.tagIds()).toEqual([work.id]);
      expect(await chipNames()).toEqual(['Work']);
      // Nothing suggests it any more.
      const input = await loader.getHarness(MatAutocompleteHarness);
      await input.enterText('fam');
      expect(await suggestions(input)).toEqual(['Create tag “fam”']);
    });

    it('deletes a tag nothing uses without asking', async () => {
      await addTag('Family', tagColorPresets[0].color);
      await fixture.whenStable();
      const menu = await loader.getHarness(MatMenuHarness.with({ selector: '.delete-tags' }));
      await menu.clickItem({ text: 'Family' });
      await until(() => tags.records().length === 0);
      expect(questions).toEqual([]);
    });
  });
});
