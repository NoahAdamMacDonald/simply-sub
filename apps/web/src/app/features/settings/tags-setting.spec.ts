import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { tagColorPresets, type ListItem, type Tag } from '@simply-sub/core';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService, type ConfirmOptions } from '../../shared/confirm/confirm-service';
import { TagsSetting } from './tags-setting';

// Settings' Custom tags (P13, M6.11) on a fake IndexedDB: each tag renamed and recoloured in place, ⊕ for a new one,
// and ✕, which asks first when subscriptions use the tag. ConfirmService answers as each test says.

describe('TagsSetting', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<TagsSetting>;
  let tags: TagsRepository;
  let questions: ConfirmOptions[];
  let answer: boolean;

  beforeEach(async () => {
    storage = testStorage();
    questions = [];
    answer = true;
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        {
          provide: ConfirmService,
          useValue: {
            confirm: async (options: ConfirmOptions) => {
              questions.push(options);
              return answer;
            },
          },
        },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    tags = TestBed.inject(TagsRepository);
    await until(() => tags.status() === 'ready');
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  async function addTag(name: string, color: string): Promise<Tag> {
    const tag = await tags.create({ name, color });
    await until(() => tags.byId().has(tag.id));
    return tag;
  }

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(TagsSetting);
    await fixture.whenStable();
  }

  async function settle(condition: () => boolean = () => true): Promise<void> {
    await until(() => {
      fixture.detectChanges();
      return condition();
    });
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () =>
    Array.from(element().querySelectorAll('li .row')).map((row) =>
      row.querySelector('.name')?.textContent?.trim(),
    );
  const button = (tag: Tag, kind: 'swatch' | 'rename' | 'remove') =>
    element().querySelector<HTMLButtonElement>(`[data-tag="${tag.id}"] .${kind}`)!;
  const field = (label: string) =>
    Array.from(element().querySelectorAll<HTMLInputElement>('ss-tag-editor input[matInput]')).find(
      (input) => input.closest('mat-form-field')?.textContent?.includes(label),
    )!;

  function type(input: HTMLInputElement, text: string): void {
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  function submit(): void {
    element().querySelector<HTMLFormElement>('ss-tag-editor form')!.requestSubmit();
  }

  it('says there are none yet, and offers a new one', async () => {
    await render();
    expect(element().querySelector('.hint')?.textContent).toContain('No tags yet');
    expect(element().querySelector('.add')?.textContent).toContain('New tag');
  });

  it('lists each tag with its colour, named for screen readers, and its buttons', async () => {
    const family = await addTag('Family', tagColorPresets[7].color);
    await addTag('Work', '#123abc');
    await render();
    expect(rows()).toEqual(['Family', 'Work']);
    expect(button(family, 'swatch').getAttribute('aria-label')).toBe('Colour of Family: Blue');
    expect(button(family, 'rename').getAttribute('aria-label')).toBe('Rename Family');
    expect(button(family, 'remove').getAttribute('aria-label')).toBe('Delete Family');
    expect(element().querySelector('[aria-label="Colour of Work: #123abc"]')).not.toBeNull();
  });

  it('renames a tag in place: ✎ opens its name, Enter saves, and focus goes back to ✎', async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    await render();
    button(family, 'rename').click();
    await settle(() => document.activeElement === field('Name'));
    expect(field('Name').value).toBe('Family');

    type(field('Name'), '  Home  ');
    submit();
    await settle(() => tags.byId().get(family.id)?.name === 'Home');
    expect(tags.byId().get(family.id)?.color).toBe(tagColorPresets[0].color);
    await settle(() => document.activeElement === button(family, 'rename'));
    expect(rows()).toEqual(['Home']);
  });

  it("refuses an empty name or another tag's, in any case, and keeps the editor open", async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    await addTag('Work', tagColorPresets[1].color);
    await render();
    button(family, 'rename').click();
    await settle();

    type(field('Name'), ' ');
    submit();
    await settle(() => element().textContent?.includes('Give the tag a name') === true);

    type(field('Name'), 'WORK');
    submit();
    await settle(
      () => element().textContent?.includes("There's a tag called “Work” already") === true,
    );
    expect(document.activeElement).toBe(field('Name'));
    expect(tags.byId().get(family.id)?.name).toBe('Family');

    // Its own name in another case is fine.
    type(field('Name'), 'FAMILY');
    submit();
    await settle(() => tags.byId().get(family.id)?.name === 'FAMILY');
  });

  it('recolours a tag from its swatch: a preset by its radio, or any hex colour', async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    await render();
    button(family, 'swatch').click();
    // Focus starts on the colour it has.
    await settle(
      () => (document.activeElement as HTMLInputElement | null)?.value === tagColorPresets[0].color,
    );

    const teal = element().querySelector<HTMLInputElement>(
      `ss-tag-colours input[value="${tagColorPresets[5].color}"]`,
    )!;
    teal.click();
    await settle();
    expect(field('Hex colour').value).toBe(tagColorPresets[5].color);
    submit();
    await settle(() => tags.byId().get(family.id)?.color === tagColorPresets[5].color);
    await settle(() => document.activeElement === button(family, 'swatch'));

    button(family, 'swatch').click();
    await settle();
    type(field('Hex colour'), 'ABC');
    submit();
    await settle(() => element().textContent?.includes('Use six hex digits') === true);
    type(field('Hex colour'), '#12AB9F');
    await settle();
    // No preset is that colour, so none is checked.
    expect(element().querySelector('ss-tag-colours input:checked')).toBeNull();
    submit();
    await settle(() => tags.byId().get(family.id)?.color === '#12ab9f');
  });

  it('cancels an edit with Escape, changing nothing', async () => {
    const family = await addTag('Family', tagColorPresets[0].color);
    await render();
    button(family, 'rename').click();
    await settle();
    type(field('Name'), 'Home');
    field('Name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(() => document.activeElement === button(family, 'rename'));
    expect(tags.byId().get(family.id)?.name).toBe('Family');
    expect(element().querySelector('ss-tag-editor')).toBeNull();
  });

  it('adds a tag with ⊕, in edit mode with a free colour, then focuses its ✎', async () => {
    await addTag('Family', tagColorPresets[0].color);
    await render();
    element().querySelector<HTMLButtonElement>('.add')!.click();
    await settle(() => document.activeElement === field('Name'));
    expect(field('Name').value).toBe('');
    expect(field('Hex colour').value).toBe(tagColorPresets[1].color);
    // ⊕ hides while its row is open.
    expect(element().querySelector('.add')).toBeNull();

    type(field('Name'), 'Gym');
    submit();
    await settle(() => tags.records().length === 2);
    const gym = tags.records()[1];
    expect([gym.name, gym.color]).toEqual(['Gym', tagColorPresets[1].color]);
    await settle(() => document.activeElement === button(gym, 'rename'));
  });

  describe('✕', () => {
    let family: Tag;
    let work: Tag;

    beforeEach(async () => {
      family = await addTag('Family', tagColorPresets[0].color);
      work = await addTag('Work', tagColorPresets[1].color);
    });

    it('deletes a tag nothing uses without asking, and moves focus to the next ✕', async () => {
      await render();
      button(family, 'remove').click();
      await settle(() => !tags.byId().has(family.id));
      expect(questions).toEqual([]);
      await settle(() => document.activeElement === button(work, 'remove'));
      expect(rows()).toEqual(['Work']);
    });

    it('asks first when subscriptions use it, then takes it off them', async () => {
      const listId = (await TestBed.inject(ListsRepository).create({ name: 'Work Related' })).id;
      const items = TestBed.inject(ItemsRepository);
      const fields = (planId: string): Omit<ListItem, 'id' | 'createdAt' | 'updatedAt'> => ({
        listId,
        source: { kind: 'catalog', planId },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-11-12',
          autoRenew: true,
        },
        tagIds: [work.id, family.id],
        rankOverrides: {},
        pinned: false,
      });
      await items.create(fields('netflix.standard'));
      await items.create(fields('mullvad.vpn'));
      await render();

      answer = false;
      button(family, 'remove').click();
      await settle(() => questions.length === 1);
      expect(questions[0]).toEqual({
        title: 'Delete “Family”?',
        message: 'Used by 2 subscriptions. It comes off them in every list.',
        confirmText: 'Delete tag',
        danger: true,
      });
      expect(tags.byId().has(family.id)).toBe(true);

      answer = true;
      button(family, 'remove').click();
      await settle(() => !tags.byId().has(family.id));
      const stored = (await storedRows(storage.indexedDB, 'items')) as ListItem[];
      expect(stored.map((item) => item.tagIds)).toEqual([[work.id], [work.id]]);
      // The last row: focus goes to the previous one's ✕.
      await settle(() => document.activeElement === button(work, 'remove'));
    });

    it('moves focus to ⊕ once the last tag is gone', async () => {
      await render();
      button(family, 'remove').click();
      await settle(() => !tags.byId().has(family.id));
      button(work, 'remove').click();
      await settle(() => tags.records().length === 0);
      await settle(() => document.activeElement === element().querySelector('.add'));
    });
  });
});
