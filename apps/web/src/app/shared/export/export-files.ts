import {
  calendarEvents,
  currencyDigits,
  exportFileName,
  exportWorkbook,
  itemTable,
  listFile,
  listText,
  paymentTable,
  paymentsFile,
  paymentsText,
  type CalendarEvent,
  type CustomSubscription,
  type ExportCell,
  type ExportContext,
  type ExportFormat,
  type ExportList,
  type ExportSheet,
  type ExportTable,
} from '@simply-sub/core';

// The exports' files (BLUEPRINT §11.2, M7.5), loaded with the first export: core lays each file out, and a library
// writes it, loaded only for its format: papaparse the CSV, exceljs the workbook, ics the calendar.

/** What a list's Export offers (P4). */
export type ListExportFormat = 'csv' | 'xlsx' | 'json' | 'txt' | 'ics';
/** What the Calendar's Export to file offers (P10; JSON and Text since M7.9). */
export type PaymentsExportFormat = 'ics' | 'csv' | 'xlsx' | 'json' | 'txt';

/** A file to save. */
export interface ExportFile {
  name: string;
  content: BlobPart;
  type: string;
}

/** What a file is made from: the lists, today with the user's currency, tax place and tags, and how they write money. */
export interface ExportRequest {
  lists: readonly ExportList[];
  context: ExportContext;
  format: ExportFormat;
}

const types = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  txt: 'text/plain;charset=utf-8',
  ics: 'text/calendar;charset=utf-8',
} as const;

/** What the calendars' importers list the file's events under. */
const productId = '-//sub.simplely.ca//Simply Sub//EN';

/**
 * One list's file (List view's Export, P4): its items as a CSV; the workbook; the list, its items and what they name
 * as JSON; a summary as text; or its next 12 months' charges as a calendar.
 */
export async function listExport(
  { lists, context, format }: ExportRequest,
  kind: ListExportFormat,
  customSubs: ReadonlyMap<string, CustomSubscription>,
): Promise<ExportFile> {
  const [one] = lists;
  const name = exportFileName(one.list.name, context.today, kind);
  const file = (content: BlobPart) => ({ name, content, type: types[kind] });
  switch (kind) {
    case 'csv':
      return file(await csvText(itemTable(lists, context)));
    case 'xlsx':
      return file(await workbookBytes(exportWorkbook(lists, context)));
    case 'json': {
      const items = [...one.resolved, ...one.unresolved].map(({ item }) => item);
      const json = listFile(one.list, items, { tags: context.tags, customSubs }, context.today);
      return file(JSON.stringify(json, null, 2));
    }
    case 'txt':
      return file(listText(one, context, format));
    case 'ics':
      return file(
        await icsText(calendarEvents(lists, context, format), `Simply Sub: ${one.list.name}`),
      );
  }
}

/**
 * The Calendar's file (Export to file and Sync calendar, P10): the next 12 months' charges of the lists shown, as a
 * calendar, a CSV payment schedule, the workbook, or the schedule as JSON or text (M7.9).
 */
export async function paymentsExport(
  { lists, context, format }: ExportRequest,
  kind: PaymentsExportFormat,
): Promise<ExportFile> {
  const name = exportFileName('payments', context.today, kind);
  const file = (content: BlobPart) => ({ name, content, type: types[kind] });
  switch (kind) {
    case 'ics':
      return file(await icsText(calendarEvents(lists, context, format), 'Simply Sub payments'));
    case 'csv':
      return file(await csvText(paymentTable(lists, context)));
    case 'xlsx':
      return file(await workbookBytes(exportWorkbook(lists, context)));
    case 'json':
      return file(JSON.stringify(paymentsFile(lists, context), null, 2));
    case 'txt':
      return file(paymentsText(lists, context, format));
  }
}

/**
 * A CSV file (RFC 4180, CRLF), with a byte order mark so Excel reads it as UTF-8. A cell of text that starts like a
 * formula (=, +, -, @) gets a ' first, so a spreadsheet shows it rather than running it.
 */
async function csvText({ columns, rows }: ExportTable): Promise<string> {
  const { unparse } = commonJs(await import('papaparse'));
  const byteOrderMark = String.fromCharCode(0xfeff);
  return (
    byteOrderMark +
    unparse(
      { fields: columns.map((column) => column.header), data: rows.map((row) => [...row]) },
      { escapeFormulae: true },
    )
  );
}

/**
 * A calendar of all-day events (`VALUE=DATE`), which no time zone can move to another day, each with its tags as its
 * categories (M7.9).
 */
async function icsText(events: readonly CalendarEvent[], calName: string): Promise<string> {
  const { createEvents } = commonJs(await import('ics'));
  const { error, value } = createEvents(
    events.map((event) => ({ ...event, transp: 'TRANSPARENT' as const })),
    { productId, method: 'PUBLISH', calName },
  );
  if (error || value === null) throw error ?? new Error('The calendar file was empty');
  return value;
}

/**
 * An Excel workbook of `sheets`: a bold header row that stays put, columns as wide as what they hold, amounts with
 * their currency's decimals and dates as dates.
 */
async function workbookBytes(sheets: readonly ExportSheet[]): Promise<ArrayBuffer> {
  const { Workbook } = commonJs(await import('exceljs'));
  const workbook = new Workbook();
  workbook.creator = 'Simply Sub';
  for (const { name, columns, rows } of sheets) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((column, index) => ({
      header: column.header,
      width: columnWidth(
        column.header,
        rows.map((row) => row[index]),
      ),
    }));
    sheet.getRow(1).font = { bold: true };
    const currencyColumn = columns.findIndex((column) => column.kind === 'currency');
    for (const row of rows) {
      const added = sheet.addRow(
        row.map((cell, index) =>
          columns[index].kind === 'date' && typeof cell === 'string' ? utcDate(cell) : cell,
        ),
      );
      columns.forEach((column, index) => {
        if (column.kind === 'date') added.getCell(index + 1).numFmt = 'yyyy-mm-dd';
        if (column.kind === 'money') {
          const currency = row[currencyColumn];
          const digits = typeof currency === 'string' ? currencyDigits(currency) : 2;
          added.getCell(index + 1).numFmt = digits === 0 ? '#,##0' : `#,##0.${'0'.repeat(digits)}`;
        }
      });
    }
  }
  return workbook.xlsx.writeBuffer();
}

/**
 * A CommonJS library's exports from a dynamic import. The production build's chunk optimizer gives them as `default`
 * only, keeping just what the code reads of the namespace, while the dev server and the tests give them by name too:
 * `default` when there is one, read through a call so the build keeps it.
 */
function commonJs<T extends object>(namespace: T): T {
  return (namespace as { default?: T }).default ?? namespace;
}

/** A column's width in characters: its longest cell or header, with a little room, up to 48. */
function columnWidth(header: string, cells: readonly ExportCell[]): number {
  const longest = Math.max(header.length, ...cells.map((cell) => String(cell ?? '').length));
  return Math.min(48, Math.max(8, longest + 2));
}

/** An ISO date as the day itself: midnight UTC, which exceljs writes as that day. */
function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
