import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatRadioButtonHarness } from '@angular/material/radio/testing';
import { syncSchemaVersion, type SyncCopy, type SyncRecord } from '@simply-sub/core';
import { testStorage } from '../../core/storage/storage.testing';
import { ThemeService } from '../../core/theme/theme-service';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { JoinLinks, type TakenLink } from '../../shared/sync/join-links';
import { SyncService, type JoinPreview } from '../../shared/sync/sync-service';
import { JoinSyncDialog, type JoinSyncData } from './join-sync-dialog';

// Join with a code (M10.9): the words pasted, completed or mistyped, what the copy holds, and Merge, with a stand-in
// for SyncService; a join link taken and a QR code scanned (M10.14), with a stand-in for JoinLinks; and a new device in
// its first run (M10.15). The code is 32 zero bytes: "abandon" 23 times, then "art".

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
  copy: {
    ...copy,
    settings: { country: 'CA', currency: 'CAD', updatedAt: '2026-10-19T10:00:00.000Z' },
  },
  version: '4',
};
const link = {
  id: 'YGFiY2RlZmdoaWprbG1ubw',
  key: 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8',
};

describe('JoinSyncDialog', () => {
  let preview: ReturnType<typeof vi.fn>;
  let join: ReturnType<typeof vi.fn>;
  let take: ReturnType<typeof vi.fn<() => Promise<TakenLink>>>;
  let record: ReturnType<typeof signal<SyncRecord | undefined>>;
  let confirm: ReturnType<typeof vi.fn>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    preview = vi.fn(async () => found);
    join = vi.fn(async () => 'synced');
    take = vi.fn(async (): Promise<TakenLink> => ({ kind: 'code', seed: new Uint8Array(32) }));
    record = signal<SyncRecord | undefined>(undefined);
    confirm = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SyncService, useValue: { preview, join, record } },
        { provide: JoinLinks, useValue: { take } },
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

  /** Join again, opened as `data` says: from the first run, or with a link. */
  async function reopen(data: JoinSyncData): Promise<void> {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(MatDialog).open(JoinSyncDialog, { data });
    await vi.waitFor(async () =>
      expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1),
    );
  }
  /** The dialog open now. */
  const dialog = () => TestBed.inject(MatDialog).openDialogs[0].componentInstance as JoinSyncDialog;
  const title = async () => (await loader.getHarness(MatDialogHarness)).getTitleText();
  const error = () => document.querySelector('.error')?.textContent ?? '';
  const theme = () => TestBed.inject(ThemeService).mode();

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
    await vi.waitFor(() =>
      expect(join).toHaveBeenCalledWith(new Uint8Array(32), found, 'merge', theme()),
    );
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
    await vi.waitFor(() =>
      expect(join).toHaveBeenCalledWith(new Uint8Array(32), found, 'replace', theme()),
    );
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

  it('in the first run, joins what the copy holds, with nothing here to merge or replace (M10.15)', async () => {
    await reopen({ firstRun: true });
    await pasteInto(words.join(' '));
    await (await continueButton()).click();
    await vi.waitFor(async () => expect(await title()).toBe('Join this synced copy'));
    expect(await loader.getAllHarnesses(MatRadioButtonHarness)).toHaveLength(0);
    expect(document.querySelector('mat-dialog-content')?.textContent).toContain(
      'the theme stays this device’s',
    );

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Join' }))).click();
    await vi.waitFor(() =>
      expect(join).toHaveBeenCalledWith(new Uint8Array(32), found, 'merge', theme()),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('in the first run, refuses a copy with no settings to start from', async () => {
    preview.mockResolvedValue({ ...found, copy });
    await reopen({ firstRun: true });
    await pasteInto(words.join(' '));
    await (await continueButton()).click();
    await vi.waitFor(() => expect(error()).toContain('no settings to start from'));
  });

  it('takes the join link it’s opened with, and shows what its copy holds (M10.14)', async () => {
    await reopen({ link });
    await vi.waitFor(async () => expect(await title()).toBe('Join this synced copy'));
    expect(take).toHaveBeenCalledExactlyOnceWith(link);
    expect(preview).toHaveBeenCalledWith(new Uint8Array(32));
  });

  it('says when a join link was used or has expired, and takes the words instead', async () => {
    take.mockResolvedValue({ kind: 'gone' });
    await reopen({ link });
    await vi.waitFor(() => expect(error()).toContain('This link was used or has expired.'));
    expect(preview).not.toHaveBeenCalled();
    await pasteInto(words.join(' '));
    await (await continueButton()).click();
    await vi.waitFor(async () => expect(await title()).toBe('Join this synced copy'));
  });

  it('takes a scanned join link, and says what else it scanned isn’t one of its codes', async () => {
    dialog()['scanned']('https://example.com/');
    await vi.waitFor(() => expect(error()).toContain('isn’t a sync code'));
    dialog()['scanned'](`https://preview.example.workers.dev/join#${link.id}.${link.key}`);
    await vi.waitFor(() => expect(error()).toContain('another site’s'));
    expect(take).not.toHaveBeenCalled();

    dialog()['scanned'](`${document.location.origin}/join#${link.id}.${link.key}`);
    await vi.waitFor(async () => expect(await title()).toBe('Join this synced copy'));
    expect(take).toHaveBeenCalledExactlyOnceWith(link);
  });

  it('looks up the words of a scanned code, the QR code before M10.14', async () => {
    dialog()['scanned'](words.join(' '));
    await vi.waitFor(async () => expect(await title()).toBe('Join this synced copy'));
    expect(preview).toHaveBeenCalledWith(new Uint8Array(32));
  });

  it('says when this device already syncs with the copy, and joins nothing', async () => {
    record.set({
      key: 'sync',
      seed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      deviceId: '0192f1d0-0000-7000-8000-00000000000a',
      deviceName: 'Edge on Windows',
      updatedAt: '2026-10-25T11:58:00.000Z',
    });
    await pasteInto(words.join(' '));
    await (await continueButton()).click();
    await vi.waitFor(() => expect(error()).toContain('This device already syncs with this copy'));
    expect(preview).not.toHaveBeenCalled();
  });

  it('opens the camera to scan, and stops it, giving focus back to Scan the QR code', async () => {
    await (await loader.getHarness(MatButtonHarness.with({ text: /Scan the QR code$/ }))).click();
    // No camera in the tests' browser: the scanner says so in words.
    await vi.waitFor(() =>
      expect(document.querySelector('ss-qr-scanner .status')?.textContent).toContain('camera'),
    );
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Stop scanning' }))).click();
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent).toContain('Scan the QR code'),
    );
  });
});
