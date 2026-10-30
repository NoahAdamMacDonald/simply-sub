import {
  reportedPrices,
  type IsoDate,
  type Price,
  type ReportCount,
  type ReportedPlan,
  type SnapshotProvider,
} from '@simply-sub/core';
import type { Finding } from './types';

// Price reports (BLUEPRINT §6.4, M10.10): what visitors said is wrong with a plan's price in their country, handed over
// by the API's nightly clean-up, a KV key per plan. The night they arrive, the plan's pages for those countries are
// checked whatever their cadence, within the night's budgets, and the weekly digest says what each page showed: a new
// price is the edit any check makes, the catalog's price still there is a line in the body, a page that couldn't be
// read is a review item, and a country the catalog doesn't price yet is counted for the regions to add (M10.13).

/** Each reported plan's countries. */
export function reportedCountries(reported: readonly ReportedPlan[]): Map<string, string[]> {
  return new Map(
    reported.map(({ plan, reports }) => [
      plan,
      [...new Set(reports.map((report) => report.country))],
    ]),
  );
}

/** The pages a provider's reported plans are priced on in the countries they were reported from. */
export function reportedPages(
  provider: SnapshotProvider,
  countries: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const pages = new Set<string>();
  for (const plan of provider.plans) {
    for (const country of countries.get(plan.id) ?? []) {
      for (const price of reportedPrices(plan.prices, country)) {
        if (price.sourceUrl !== undefined) pages.add(price.sourceUrl);
      }
    }
  }
  return pages;
}

/**
 * Whether a finding confirms a reported plan's price. A confirmation is kept for the digest only when its price's check
 * is due (proposal.ts), but a reported plan's is kept too: the digest says the page still shows the catalog's price.
 */
export function confirmsReported(
  finding: Finding,
  countries: ReadonlyMap<string, readonly string[]>,
): boolean {
  return (
    finding.kind === 'confirmed' &&
    finding.target.owner.kind === 'plan' &&
    countries.has(finding.target.owner.id)
  );
}

/** A reported plan as the digest names it ("Netflix Standard"), with its prices. */
export interface ReportedPlanInfo {
  label: string;
  prices: Price[];
}

/** What a plan's page showed for the reports from one country. */
export interface ReportOutcome {
  label: string;
  country: string;
  /** What was reported: "3 reports of 20.99 CAD monthly and 1 that it isn't sold any more". */
  said: string;
  first: IsoDate;
  last: IsoDate;
  /**
   * new: the page shows another price, whose edit the digest has; same: the catalog's price is still there; unread:
   * the page couldn't be read, or the price has no page the bot reads; gone: the catalog doesn't have the plan now.
   */
  shown: 'new' | 'same' | 'unread' | 'gone';
  /** What the page shows (new) or the catalog's prices (same), as "21.99 CAD monthly". */
  prices: string[];
  /** The pages a person should read (unread). */
  urls: string[];
}

/** The reports from a country the catalog doesn't price the plan in yet, by country. */
export interface AskedRegion {
  country: string;
  count: number;
  /** Each plan reported there, with how many reports, most first. */
  plans: { label: string; count: number }[];
}

export interface ReportOutcomes {
  outcomes: ReportOutcome[];
  /** Most reports first. */
  regions: AskedRegion[];
}

/** What each reported plan's pages showed in each country it was reported from, by the week's findings. */
export function reportOutcomes(
  reported: readonly ReportedPlan[],
  plans: ReadonlyMap<string, ReportedPlanInfo>,
  findings: readonly Finding[],
): ReportOutcomes {
  const outcomes: ReportOutcome[] = [];
  const asked = new Map<string, Map<string, number>>();
  for (const { plan, reports } of reported) {
    const info = plans.get(plan);
    for (const country of new Set(reports.map((report) => report.country))) {
      const here = reports.filter((report) => report.country === country);
      const summary = {
        label: info?.label ?? plan,
        country,
        said: said(here),
        first: here.map((report) => report.first).sort()[0],
        last: here
          .map((report) => report.last)
          .sort()
          .at(-1) as IsoDate,
      };
      if (info === undefined) {
        outcomes.push({ ...summary, shown: 'gone', prices: [], urls: [] });
        continue;
      }
      const prices = reportedPrices(info.prices, country);
      if (prices.length === 0) {
        const byPlan = asked.get(country) ?? new Map<string, number>();
        const count = here.reduce((sum, report) => sum + report.count, 0);
        byPlan.set(info.label, (byPlan.get(info.label) ?? 0) + count);
        asked.set(country, byPlan);
        continue;
      }
      const about = findings.filter((finding) => concerns(finding, plan, prices));
      const changed = about.filter(
        (finding): finding is Extract<Finding, { kind: 'changed' }> => finding.kind === 'changed',
      );
      if (changed.length > 0) {
        outcomes.push({
          ...summary,
          shown: 'new',
          prices: changed.map((finding) =>
            amountText({ ...finding.target.price, amount: finding.amount }),
          ),
          urls: [],
        });
      } else if (about.some((finding) => finding.kind === 'confirmed')) {
        outcomes.push({ ...summary, shown: 'same', prices: prices.map(amountText), urls: [] });
      } else {
        const urls = [...new Set(prices.flatMap((price) => price.sourceUrl ?? []))];
        outcomes.push({ ...summary, shown: 'unread', prices: [], urls });
      }
    }
  }
  const regions = [...asked]
    .map(([country, byPlan]) => ({
      country,
      count: [...byPlan.values()].reduce((sum, count) => sum + count, 0),
      plans: [...byPlan]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  return { outcomes, regions };
}

/** Whether a finding is about one of the plan's prices that a report is about. */
function concerns(finding: Finding, plan: string, prices: readonly Price[]): boolean {
  if (finding.kind !== 'changed' && finding.kind !== 'confirmed') return false;
  const { owner, price } = finding.target;
  return (
    owner.kind === 'plan' &&
    owner.id === plan &&
    prices.some(
      (mine) =>
        mine.region === price.region &&
        mine.currency === price.currency &&
        mine.interval === price.interval &&
        mine.intervalCount === price.intervalCount,
    )
  );
}

/** What a country's reports of a plan said, the most reported first. */
function said(reports: readonly ReportCount[]): string {
  return [...reports]
    .sort((a, b) => b.count - a.count)
    .map((report) => {
      const reportsText = report.count === 1 ? '1 report' : `${report.count} reports`;
      switch (report.problem) {
        case 'price':
          return `${reportsText} of ${report.price ? amountText(report.price) : 'another price'}`;
        case 'discontinued':
          return `${reportsText} that it isn't sold any more`;
        case 'not-in-country':
          return `${reportsText} that it isn't sold there`;
      }
    })
    .join(' and ');
}

/** A price as "20.99 CAD monthly" or "99 USD every 2 years". */
export function amountText(
  price: Pick<Price, 'amount' | 'currency' | 'interval' | 'intervalCount'>,
): string {
  const period =
    price.intervalCount === 1
      ? { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[price.interval]
      : `every ${price.intervalCount} ${price.interval}s`;
  return `${price.amount} ${price.currency} ${period}`;
}
