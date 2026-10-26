import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { RejectedRecord } from '@simply-sub/core';
import { RejectedRecords } from './rejected-records';

const item: RejectedRecord = {
  table: 'items',
  key: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
  issues: ['billing.anchorDate: invalid_format'],
};
const tag: RejectedRecord = { table: 'tags', issues: ['id: invalid_format'] };

describe('RejectedRecords', () => {
  let rejected: RejectedRecords;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    rejected = TestBed.inject(RejectedRecords);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Lets the snackbar load and render. */
  async function settle() {
    await TestBed.inject(ApplicationRef).whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }

  it('logs each record once, by its table, key and issues', () => {
    rejected.report([item, tag]);
    rejected.report([item]);
    expect(warn.mock.calls).toEqual([
      [
        "A saved record couldn't be read, so it's hidden. items record 0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b: billing.anchorDate: invalid_format",
      ],
      [
        "A saved record couldn't be read, so it's hidden. tags record (malformed key): id: invalid_format",
      ],
    ]);
    expect(rejected.count()).toBe(2);
  });

  it('tells the user once per session, until they dismiss it', async () => {
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    rejected.report([item]);
    await settle();
    rejected.report([tag]);
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    const container = document.querySelector('.mat-mdc-snack-bar-container');
    expect(container?.textContent).toContain(
      "Some saved data couldn't be read, so it's hidden. The rest is fine.",
    );
    expect(container?.textContent).toContain('Dismiss');
  });

  it("logs a cached catalog file once, and doesn't tell the user: it's downloaded again", async () => {
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    const file: RejectedRecord = {
      table: 'catalogCache',
      key: 'CA',
      issues: ['fetchedAt: invalid_format'],
    };
    rejected.report([file]);
    rejected.report([file]);
    await settle();
    expect(warn.mock.calls).toEqual([
      [
        "A cached catalog file couldn't be read, so it's downloaded again. catalogCache record CA: fetchedAt: invalid_format",
      ],
    ]);
    expect(rejected.count()).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });

  it('says nothing when there is nothing new', async () => {
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    rejected.report([]);
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
