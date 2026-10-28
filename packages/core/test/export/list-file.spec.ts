import { describe, expect, it } from 'vitest';
import {
  backupRefusals,
  exportFileName,
  listFile,
  readBackupText,
  type CustomSubscription,
  type ListItem,
} from '../../src';
import { customSub } from '../user/fixtures';
import { context, familyTag, netflix, today, work } from './fixtures';

// List view's JSON export and the exports' file names (M7.5).

describe('listFile', () => {
  const custom = customSub as CustomSubscription;
  const gym: ListItem = {
    ...netflix.item,
    id: '0192f1c5-1c2d-7e3f-8a4b-000000000077',
    source: { kind: 'custom', customSubId: custom.id, customPlanId: custom.plans[0].id },
    tagIds: [],
  };
  const file = listFile(
    work,
    [netflix.item, gym],
    { tags: context.tags, customSubs: new Map([[custom.id, custom]]) },
    today,
  );

  it('holds the list and its items as they’re stored, naming only live tags', () => {
    expect(file.app).toBe('simply-sub');
    expect(file.file).toBe('list');
    expect(file.exportedOn).toBe(today);
    expect(file.list).toEqual(work);
    expect(file.items).toEqual([{ ...netflix.item, tagIds: [familyTag.id] }, gym]);
  });

  it('holds the custom subscriptions and tags its items name', () => {
    expect(file.customSubs).toEqual([custom]);
    expect(file.tags).toEqual([familyTag]);
  });

  it('isn’t a backup: Import refuses it', () => {
    expect(readBackupText(JSON.stringify(file))).toEqual({
      kind: 'refused',
      reason: backupRefusals.notBackup,
    });
  });
});

describe('exportFileName', () => {
  it('is the app, what the file holds and the day', () => {
    expect(exportFileName('Work Related', today, 'csv')).toBe(
      'simply-sub-work-related-2026-10-28.csv',
    );
    expect(exportFileName('payments', today, 'ics')).toBe('simply-sub-payments-2026-10-28.ics');
  });

  it('keeps plain letters and digits only', () => {
    expect(exportFileName('Famille Côté (2)', today, 'txt')).toBe(
      'simply-sub-famille-cote-2-2026-10-28.txt',
    );
    expect(exportFileName('家族', today, 'json')).toBe('simply-sub-list-2026-10-28.json');
    expect(exportFileName(`${'a'.repeat(39)} b`, today, 'xlsx')).toBe(
      `simply-sub-${'a'.repeat(39)}-2026-10-28.xlsx`,
    );
  });
});
