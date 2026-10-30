import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatRadioButtonHarness } from '@angular/material/radio/testing';
import { syncSchemaVersion, type SyncCopy } from '@simply-sub/core';
import { testStorage } from '../../core/storage/storage.testing';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { SyncService, type JoinPreview } from '../../shared/sync/sync-service';
import { JoinSyncDialog } from './join-sync-dialog';

// Join with a code (M10.9): the words pasted, completed or mistyped, what the copy holds, and Merge, with a stand-in
// for SyncService. The code is 32 zero bytes: "abandon" 23 times, then "art".

@Component({ template: '' })
class Host {}

const words = [...Array<string>(23).fill('abandon'), 'art'];
const copy: SyncCopy = {
  schemaVersion: syncSchemaVersion,
  data: {
    tags: [],
    customSubs: [],
    lists: [
      {
        id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
        name: 'Shared',
        createdAt: '2026-10-19T10:00:00.000Z',
        updatedAt: '2026-10-19T10:00:00.000Z',
      },
    ],
    items: [],
    rankings: [],
    cards: [],
    dismissedSuggestions: [],
    liveCalendar: [],
  },
  devices: [],
};
const found: JoinPreview = {
  kind: 'copy',
  counts: { lists: 1, items: 0, customSubs: 0, rankings: 0, cards: 0, tags: 0 },
  copy,
  version: '4',
};

describe('JoinSyncDialog', () => {
  let preview: ReturnType<typeof vi.fn>;
  let join: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    preview = vi.fn(async () => found);
    join = vi.fn(async () => 'synced');
    confirm = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SyncService, useValue: { preview, join } },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    TestBed.inject(MatDialog).open(JoinSyncDialog);
    await fixture.whenStable();
  });

  afterEach(() => TestBed.inject(MatDialog).closeAll());

  const box = (index: number) =>
    loader.getHarness(
      MatInputHarness.with({ selector: `.words mat-form-field:nth-child(${index}) input` }),
    );
  const pasteInto = async (text: string) => {
    const input = document.querySelector<HTMLInputElement>('.words input');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    input?.dispatchEvent(event);
    await TestBed.inject(MatDialog).openDialogs[0]?.componentRef?.changeDetectorRef.detectChanges();
  };
  const continueButton = () =>
    loader.getHarness(MatButtonHarness.with({ text: /^(Continue|Looking for it…)$/ }));

  it('takes the words pasted at once, shows what the copy holds, and merges by default', async () => {
    await pasteInto(words.join(' '));
    expect(await (await box(24)).getValue()).toBe('art');
    await (await continueButton()).click();
    await vi.waitFor(async () =>
      expect(await (await loader.getHarness(MatDialogHarness)).getTitleText()).toBe(
        'Join this synced copy',
      ),
    );
    expect(document.querySelector('mat-dialog-content')?.textContent).toContain('It holds 1 list.');
    expect(preview).toHaveBeenCalledWith(new Uint8Array(32));

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Join' }))).click();
    await vi.waitFor(() => expect(join).toHaveBeenCalledWith(new Uint8Array(32), found, 'merge'));
  });

  it('looks once and joins once, however often Continue and Join are clicked meanwhile', async () => {
    let answer: (preview: JoinPreview) => void = () => undefined;
    preview.mockImplementation(() => new Promise<JoinPreview>((resolve) => (answer = resolve)));
    join.mockImplementation(() => new Promise(() => undefined));
    await pasteInto(words.join(' '));
    await (await continueButton()).click();
    await (await continueButton()).click();
    expect(preview).toHaveBeenCalledTimes(1);

    answer(found);
    const title = async () => (await loader.getHarness(MatDialogHarness)).getTitleText();
    await vi.waitFor(async () => expect(await title()).toBe('Join this synced copy'));
    const joinButton = () =>
      loader.getHarness(MatButtonHarness.with({ text: /^(Join|Joining…)$/ }));
    await (await joinButton()).click();
    await (await joinButton()).click();
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Back' }))).click();
    expect(join).toHaveBeenCalledTimes(1);
    expect(await title()).toBe('Join this synced copy');
  });

  it('asks before replacing this device’s data, and replaces it only once that’s confirmed', async () => {
    confirm.mockResolvedValueOnce(false);
    await pasteInto(words.join(' '));
    await (await continueButton()).click();
    await vi.waitFor(async () =>
      expect(await (await loader.getHarness(MatDialogHarness)).getTitleText()).toBe(
        'Join this synced copy',
      ),
    );
    await (await loader.getHarness(MatRadioButtonHarness.with({ label: /^Replace it/ }))).check();
    const joinButton = () =>
      loader.getHarness(MatButtonHarness.with({ text: /^(Join|Joining…)$/ }));
    await (await joinButton()).click();
    await vi.waitFor(async () => expect(await (await joinButton()).getText()).toBe('Join'));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Replace this device’s data?', danger: true }),
    );
    expect(join).not.toHaveBeenCalled();

    await (await joinButton()).click();
    await vi.waitFor(() => expect(join).toHaveBeenCalledWith(new Uint8Array(32), found, 'replace'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('completes a word from its first letters as the box is left', async () => {
    const first = await box(1);
    await first.setValue('aban');
    await first.blur();
    expect(await first.getValue()).toBe('abandon');
  });

  it('says when the words are BIP39’s but not a code, as a mistyped word makes them', async () => {
    await pasteInto([...words.slice(0, 23), 'zoo'].join(' '));
    await (await continueButton()).click();
    await vi.waitFor(() =>
      expect(document.querySelector('.error')?.textContent).toContain(
        'These words aren’t a sync code',
      ),
    );
    expect(preview).not.toHaveBeenCalled();
  });

  it('says when no synced copy uses the code', async () => {
    preview.mockResolvedValue({ kind: 'none' });
    await pasteInto(words.join(' '));
    await (await continueButton()).click();
    await vi.waitFor(() =>
      expect(document.querySelector('.error')?.textContent).toContain(
        'No synced copy uses this code',
      ),
    );
  });
});
