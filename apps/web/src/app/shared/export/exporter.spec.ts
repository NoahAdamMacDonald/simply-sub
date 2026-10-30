import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { CatalogData, ListItem, Settings, SubscriptionList } from '@simply-sub/core';
import { Workbook } from 'exceljs';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { testStorage, until } from '../../core/storage/storage.testing';
import { alberta, fx, searchCatalogData } from '../sub-card/search.testing';
import { captureDownloads, csvText, type Download } from './downloads.testing';
import { Exporter } from './exporter';

// The exports (M7.5) with their libraries, on a fake IndexedDB with Search's small catalog, for an Albertan on Oct 25,
// 2026: Work Related has Netflix Standard on the 12th (tagged Family, and with a tag deleted since) and Crave Premium
// billed on the 31st; Family has Mullvad VPN yearly on Jan 20, converted from euros and renewed by hand.

function fields(planId: string, extra: Partial<NewRecord<'items'>> = {}): NewRecord<'items'> {
  return {
    listId: '',
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...extra,
  };
}

describe('Exporter', () => {
  let saved: ReturnType<typeof signal<Settings | undefined>>;
  let downloads: Download[];
  let work: SubscriptionList;
  let family: SubscriptionList;
  let netflix: ListItem;

  beforeEach(async () => {
    downloads = captureDownloads();
    saved = signal<Settings | undefined>(alberta);
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SettingsStore, useValue: { saved } },
        {
          provide: CatalogStore,
          useValue: {
            catalog: signal<CatalogData | undefined>(searchCatalogData),
            catalogFor: () => searchCatalogData,
          },
        },
        { provide: FxStore, useValue: { rates: signal(fx) } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const lists = TestBed.inject(ListsRepository);
    const items = TestBed.inject(ItemsRepository);
    const tags = TestBed.inject(TagsRepository);
    work = await lists.create({ name: 'Work Related' });
    family = await lists.create({ name: 'Family' });
    const familyTag = await tags.create({ name: 'Family', color: '#1e88e5' });
    const gone = await tags.create({ name: 'Old', color: '#43a047' });
    netflix = await items.create({
      ...fields('netflix.standard'),
      listId: work.id,
      tagIds: [familyTag.id, gone.id],
    });
    // Deleted on its own, as a backup from before M6.11 could leave it: still named by Netflix.
    await tags.remove(gone.id);
    await items.create({
      ...fields('crave.premium'),
      listId: work.id,
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-10-31',
        autoRenew: true,
      },
    });
    await items.create({
      ...fields('mullvad.vpn'),
      listId: family.id,
      billing: {
        mode: 'recurring',
        interval: 'year',
        intervalCount: 1,
        anchorDate: '2027-01-20',
        autoRenew: false,
      },
    });
    const metrics = TestBed.inject(MetricsService);
    await until(() => metrics.list(work.id).resolved.length === 2);
    await until(() => metrics.list(family.id).resolved.length === 1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  const exporter = () => TestBed.inject(Exporter);
  const snackBar = () => document.querySelector('.mat-mdc-snack-bar-label')?.textContent?.trim();

  it('saves a list’s items as a CSV for Excel, with its live tags, and says so', async () => {
    expect(await exporter().exportList(work.id, 'csv')).toBe(
      'simply-sub-work-related-2026-10-25.csv',
    );
    const [file] = downloads;
    expect(file.name).toBe('simply-sub-work-related-2026-10-25.csv');
    expect(file.blob.type).toBe('text/csv;charset=utf-8');
    expect((await csvText(file)).split('\r\n')).toEqual([
      'List,Service,Plan,Nickname,Cost,Tax,Currency,Converted,Billed,Renews,Next charge,Ends,Status,Tags',
      'Work Related,Netflix,Standard,,19.94,0.95,CAD,,Monthly,Automatically,2026-11-12,,Active,Family',
      'Work Related,Crave,Premium,,23.1,1.1,CAD,,Monthly,Automatically,2026-10-31,,Active,',
    ]);
    await until(() => snackBar() === 'Saved simply-sub-work-related-2026-10-25.csv');
  });

  it('keeps a spreadsheet from running a cell that starts like a formula', async () => {
    const lists = TestBed.inject(ListsRepository);
    await lists.update(work.id, { name: '=HYPERLINK("x")' });
    await TestBed.inject(ItemsRepository).update(netflix.id, { nickname: '+1 for Dad' });
    const metrics = TestBed.inject(MetricsService);
    await until(() => lists.byId().get(work.id)?.name === '=HYPERLINK("x")');
    await until(() => metrics.list(work.id).resolved[0]?.item.nickname === '+1 for Dad');
    await exporter().exportList(work.id, 'csv');
    const [, netflixRow] = (await csvText(downloads[0])).split('\r\n');
    // Escaped with a ', and quoted.
    expect(netflixRow.split(',').slice(0, 5)).toEqual([
      `"'=HYPERLINK(""x"")"`,
      'Netflix',
      'Standard',
      `"'+1 for Dad"`,
      '19.94',
    ]);
  });

  it('saves the workbook: Summary, a sheet of each list’s items, then Payments', async () => {
    await exporter().exportPayments([work.id, family.id], 'xlsx');
    const [file] = downloads;
    expect(file.name).toBe('simply-sub-payments-2026-10-25.xlsx');
    const workbook = new Workbook();
    await workbook.xlsx.load(await file.blob.arrayBuffer());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Work Related',
      'Family',
      'Payments',
    ]);
    const summary = workbook.getWorksheet('Summary');
    expect(summary?.getRow(1).values).toEqual([
      undefined,
      'List',
      'This month',
      'This year',
      'Next 12 months',
      'Currency',
      'Converted',
      'Not counted',
    ]);
    // October: Netflix on the 12th and Crave on the 31st.
    expect(summary?.getRow(2).getCell(2).value).toBe(43.04);
    expect(summary?.getRow(2).getCell(2).numFmt).toBe('#,##0.00');
    const payments = workbook.getWorksheet('Payments');
    // Crave 12, Netflix 12 and Mullvad once, under the header.
    expect(payments?.rowCount).toBe(26);
    const first = payments?.getRow(2);
    expect(first?.getCell(1).value).toEqual(new Date('2026-10-31T00:00:00Z'));
    expect(first?.getCell(1).numFmt).toBe('yyyy-mm-dd');
    expect(first?.getCell(3).value).toBe('Crave');
  });

  it('saves a list as JSON with its live tags, and as text', async () => {
    await exporter().exportList(work.id, 'json');
    const json = JSON.parse(await downloads[0].blob.text());
    expect(json.list.name).toBe('Work Related');
    expect(json.items).toHaveLength(2);
    expect(json.tags.map((tag: { name: string }) => tag.name)).toEqual(['Family']);

    await exporter().exportList(work.id, 'txt');
    const text = await downloads[1].blob.text();
    expect(text.startsWith('Work Related\nExported from Simply Sub on Oct 25, 2026\n')).toBe(true);
    expect(text).toContain('Netflix Standard\n  Cost: $19.94 monthly, with $0.95 tax\n');
    expect(text).toContain('  Tags: Family\n');
    expect(text).not.toContain('Old');
  });

  it('saves each subscription as a repeating all-day event, a plan billed on the 31st on each month’s last day (M7.12, M10.2)', async () => {
    await exporter().exportPayments([work.id, family.id], 'ics');
    const [file] = downloads;
    expect(file.name).toBe('simply-sub-payments-2026-10-25.ics');
    expect(file.blob.type).toBe('text/calendar;charset=utf-8');
    const ics = await file.blob.text();
    expect(ics).toContain('X-WR-CALNAME:Simply Sub payments\r\n');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('SUMMARY:Netflix: $19.94\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113\r\n');
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12\r\n');
    expect(ics).toContain('SUMMARY:Renew Mullvad VPN: ≈ $94.16\r\n');
    // In the one form Proton Calendar takes, which drops BYSETPOS without a weekday.
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1\r\n');
  });

  it('saves the payment schedule as JSON and as text too (M7.9)', async () => {
    await exporter().exportPayments([work.id, family.id], 'json');
    expect(downloads[0].name).toBe('simply-sub-payments-2026-10-25.json');
    const json = JSON.parse(await downloads[0].blob.text());
    expect(json).toMatchObject({
      app: 'simply-sub',
      file: 'payments',
      exportedOn: '2026-10-25',
      lists: ['Work Related', 'Family'],
    });
    expect(json.payments).toHaveLength(25);
    expect(json.payments[0]).toMatchObject({ list: 'Work Related', name: 'Crave', amount: 23.1 });

    await exporter().exportPayments([work.id, family.id], 'txt');
    expect(downloads[1].name).toBe('simply-sub-payments-2026-10-25.txt');
    const text = await downloads[1].blob.text();
    expect(
      text.startsWith('Simply Sub payments\nExported on Oct 25, 2026, for the next 12 months\n'),
    ).toBe(true);
    expect(text).toContain('\nNovember 2026: ');
    expect(text).toContain(
      '  Nov 12, 2026: Netflix Standard (Work Related), $19.94, with $0.95 tax\n',
    );
  });

  it('gives each payment in the calendar its tags, as categories and in its details (M7.9)', async () => {
    await exporter().exportPayments([work.id], 'ics');
    const ics = await downloads[0].blob.text();
    expect(ics).toContain('CATEGORIES:Family\r\n');
    expect(ics).toContain('Tags: Family');
  });

  it('saves the lists’ payment schedule as a CSV, and only the lists asked for', async () => {
    await exporter().exportPayments([family.id], 'csv');
    expect((await csvText(downloads[0])).split('\r\n')).toEqual([
      'Date,List,Service,Plan,Nickname,Amount,Tax,Currency,Converted,Renews,Last charge',
      '2027-01-20,Family,Mullvad VPN,Mullvad VPN,,94.16,0,CAD,yes,Manually,',
    ]);
  });

  it('says when a file couldn’t be made, and saves nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    saved.set(undefined);
    expect(await exporter().exportList(work.id, 'csv')).toBeUndefined();
    expect(downloads).toEqual([]);
    await until(
      () => snackBar() === 'The file couldn’t be made. Check your connection, then try again.',
    );
  });
});
