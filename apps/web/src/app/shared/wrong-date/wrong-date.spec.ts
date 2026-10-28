import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { ListItem } from '@simply-sub/core';
import { ItemsRepository } from '../../core/storage/items-repository';
import { testStorage, until, type TestStorage } from '../../core/storage/storage.testing';
import { WrongDate } from './wrong-date';

// "Wrong date?" (P4, P10, M7.1): the dialog asks for the date the next charge is really on, and it becomes the
// item's anchor, saved straight to the item.

describe('WrongDate', () => {
  let storage: TestStorage;
  let items: ItemsRepository;
  let item: ListItem;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    items = TestBed.inject(ItemsRepository);
    item = await items.create({
      listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
      source: { kind: 'catalog', planId: 'netflix.standard' },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-02-28',
        billingDay: 31,
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: true,
    });
    await until(() => items.byId().has(item.id));
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  const dialog = () => document.querySelector('ss-wrong-date-dialog');
  const input = () => document.querySelector<HTMLInputElement>('ss-wrong-date-dialog input')!;
  const errors = () => dialog()?.querySelector('mat-error')?.textContent?.trim();

  async function type(text: string): Promise<void> {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    TestBed.tick();
  }

  async function submit(): Promise<void> {
    dialog()?.querySelector<HTMLFormElement>('form')?.requestSubmit();
    TestBed.tick();
  }

  it('asks with the next charge filled in, and makes a new date the item’s anchor', async () => {
    // Today is Oct 25 (FakeClock); the next charge is Oct 31.
    const asked = TestBed.inject(WrongDate).ask(item, 'Netflix Standard', '2026-10-31');
    // The dialog and the datepicker load with the first question: give them time when every spec runs at once.
    await until(() => dialog() !== null, 5000);
    expect(dialog()?.querySelector('h2')?.textContent?.trim()).toBe('Wrong date?');
    expect(dialog()?.querySelector('p')?.textContent).toContain(
      'When is Netflix Standard charged next?',
    );
    expect(input().value).toBe('2026-10-31');

    // Nov 30 still allows the 31st as its billing day.
    await type('2026-11-30');
    await submit();
    expect(await asked).toBe(true);
    await until(() => items.byId().get(item.id)?.billing.mode === 'recurring');
    await until(
      () =>
        (items.byId().get(item.id)?.billing as { anchorDate: string }).anchorDate === '2026-11-30',
    );
    expect(items.byId().get(item.id)).toMatchObject({
      billing: { anchorDate: '2026-11-30', billingDay: 31 },
      pinned: true,
    });
  });

  it('refuses a past date at the field, and saves nothing on Cancel', async () => {
    const asked = TestBed.inject(WrongDate).ask(item, 'Netflix Standard', '2026-10-31');
    await until(() => dialog() !== null, 5000);
    await type('2026-10-01');
    await submit();
    await until(() => errors() === 'Pick today or a later date');
    expect(document.activeElement).toBe(input());

    Array.from(dialog()?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Cancel')
      ?.click();
    expect(await asked).toBe(false);
    expect(items.byId().get(item.id)?.billing).toEqual(item.billing);
  });

  it('has nothing to move for Specific dates', async () => {
    const windows = {
      ...item,
      billing: {
        mode: 'limited',
        windows: [{ start: '2026-11-01', end: '2026-12-01', repeatYearly: false }],
        interval: 'month',
        intervalCount: 1,
      },
    } as ListItem;
    expect(await TestBed.inject(WrongDate).ask(windows, 'Netflix Standard', '2026-11-01')).toBe(
      false,
    );
    expect(dialog()).toBeNull();
  });
});
