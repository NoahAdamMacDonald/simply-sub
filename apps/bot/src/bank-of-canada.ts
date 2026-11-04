import {
  bankOfCanadaFileSchema,
  bankOfCanadaSeriesUrl,
  isoDateSchema,
  sameRate,
  type BankOfCanadaChange,
  type IsoDate,
} from '@simply-sub/core';
import { parse } from 'yaml';
import * as z from 'zod';
import { bankOfCanadaFile } from './proposal';
import type { Finding } from './types';

// The Bank of Canada's target for the overnight rate (M11.14): each night, its Valet series from data/bank-of-canada
// .yaml's newest change on, for a change the file doesn't have yet. A change becomes an edit in the digest, as a price
// does; data:build then works out how soon each account that follows the Bank followed it.

/** The series from a day on: each business day's rate, or why it couldn't be read. */
export type BankSeries = BankOfCanadaChange[] | { error: string };

/** The series' days and rates from Valet's JSON, or undefined when it isn't the series' shape. */
export function readSeries(json: unknown): BankOfCanadaChange[] | undefined {
  const parsed = valetShape.safeParse(json);
  if (!parsed.success) return undefined;
  return parsed.data.observations.flatMap(({ d, V39079 }) => {
    const rate = Number(V39079?.v);
    return V39079 && Number.isFinite(rate) ? [{ on: d, rate }] : [];
  });
}

const valetShape = z.object({
  observations: z.array(
    z.object({ d: isoDateSchema, V39079: z.object({ v: z.string() }).optional() }),
  ),
});

/**
 * Tonight's read of the series against the file as main has it: its new changes, newest first (each the first day of
 * a new rate), and the file's lastVerified; or, for a person, why it couldn't tell.
 */
export async function checkBankOfCanada(
  file: string | undefined,
  read: (start: IsoDate) => Promise<BankSeries>,
): Promise<Finding> {
  const subject = 'The Bank of Canada’s rate';
  let known;
  try {
    known = file === undefined ? undefined : bankOfCanadaFileSchema.safeParse(parse(file));
  } catch {
    known = undefined;
  }
  if (!known?.success) {
    return {
      kind: 'manual',
      subject,
      reason: `${bankOfCanadaFile} is missing or doesn’t validate`,
    };
  }
  const [newest] = known.data.changes;
  const series = await read(newest.on);
  if ('error' in series) {
    return { kind: 'manual', subject, url: bankOfCanadaSeriesUrl, reason: series.error };
  }
  let rate = newest.rate;
  const changes: BankOfCanadaChange[] = [];
  for (const day of [...series].sort((a, b) => (a.on < b.on ? -1 : 1))) {
    if (day.on <= newest.on || sameRate(day.rate, rate)) continue;
    changes.unshift(day);
    rate = day.rate;
  }
  return { kind: 'bank-of-canada', changes, lastVerified: known.data.lastVerified };
}
