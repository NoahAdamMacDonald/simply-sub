import {
  lockBinding,
  openedRecord,
  rowSeal,
  sealedRecordText,
  sealedRow,
  userRecordKeys,
  type LockedTable,
  type SealedText,
} from '@simply-sub/core';
import { openText, sealText } from '../crypto/passphrase-crypto';

/** What a sealed row that doesn't open reads as: the key is wrong, or the row was changed. */
export const unopened = Symbol('unopened');

/** A row whose sealed value this cipher hasn't opened yet. */
const needsOpening = Symbol('needsOpening');

/**
 * Seals and opens the locked tables' rows with the app lock's key (BLUEPRINT §11.5), while the app is unlocked. Each
 * row's value is bound to its table and key, so it can't be moved to another row. It remembers the text each row
 * opened to, so a table read again after a change opens only the rows that changed. It's dropped when the app locks,
 * and the key and the texts with it.
 */
export class RowCipher {
  /** By table, then key: the sealed value last opened or sealed here, and its text. */
  private readonly opened = new Map<
    LockedTable,
    Map<string, { sealed: SealedText; text: string }>
  >();

  constructor(
    private readonly key: CryptoKey,
    /** The salt of the lock the key was derived for: a lock with another salt needs another key. */
    readonly salt: string,
  ) {}

  /** The row to store for `record`: its plain fields, and the rest sealed. */
  async seal(table: LockedTable, record: object): Promise<Record<string, unknown>> {
    const key = keyOf(table, record);
    const text = sealedRecordText(table, record);
    const sealed = await sealText(this.key, text, lockBinding(table, key));
    this.remember(table, key, sealed, text);
    return sealedRow(table, record, sealed);
  }

  /**
   * What each row holds: a plain row itself, a sealed one its record, or `unopened`. At once, with no promise, when
   * every sealed row was opened or sealed here before.
   */
  openAll(table: LockedTable, rows: readonly unknown[]): unknown[] | Promise<unknown[]> {
    const known = rows.map((row) => this.known(table, row));
    if (!known.includes(needsOpening)) return known;
    return Promise.all(
      rows.map((row, index) =>
        known[index] === needsOpening ? this.open(table, row as object) : known[index],
      ),
    );
  }

  private known(table: LockedTable, row: unknown): unknown {
    const sealed = rowSeal(row);
    if (sealed === undefined) return row;
    const seen = this.opened.get(table)?.get(String(keyOf(table, row as object)));
    if (seen?.sealed.iv !== sealed.iv || seen.sealed.ciphertext !== sealed.ciphertext) {
      return needsOpening;
    }
    return record(table, row as object, seen.text);
  }

  private async open(table: LockedTable, row: object): Promise<unknown> {
    const sealed = rowSeal(row) as SealedText;
    const key = keyOf(table, row);
    let text: string;
    try {
      text = await openText(this.key, sealed, lockBinding(table, key));
    } catch {
      return unopened;
    }
    this.remember(table, key, sealed, text);
    return record(table, row, text);
  }

  private remember(table: LockedTable, key: unknown, sealed: SealedText, text: string): void {
    let rows = this.opened.get(table);
    if (!rows) this.opened.set(table, (rows = new Map()));
    rows.set(String(key), { sealed, text });
  }
}

function keyOf(table: LockedTable, row: object): unknown {
  return (row as Record<string, unknown>)[userRecordKeys[table]];
}

/** The record a row's text holds, parsed anew each time so no reader can change another's. */
function record(table: LockedTable, row: object, text: string): unknown {
  try {
    return openedRecord(table, row, text);
  } catch {
    return unopened;
  }
}
