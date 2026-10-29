import {
  baselineDiff,
  baselineLines,
  comparable,
  excerpt,
  findQuote,
  missingQuotes,
  moneyIn,
  nameIndexes,
  networksNamedIn,
  pageShows,
  readIconImage,
  sameAmount,
  sameCurrency,
  taxWording,
  type Baseline,
  type CitedType,
} from '@simply-sub/core';
import {
  extractionRequest,
  neuronEstimate,
  readExtraction,
  type ExtractionRequest,
  type ExtractedPrice,
} from './extraction';
import { findIcon, gitBlobSha, toBase64, type Download } from './icons';
import { priceText } from './targets';
import type {
  ApprovalTarget,
  Budget,
  Finding,
  NetworksTarget,
  PolicyPageTarget,
  PriceTarget,
} from './types';

// One provider's (or bundle's, or reseller's) part of the nightly check (BLUEPRINT §6.4), a Workflow step: each of its
// pages read once, its prices looked for on them, its taxIncluded quotes, resellers' approvals and accepted card
// networks checked, and its logo compared. A price whose stored amount is still on its page is confirmed without Workers AI; for the rest, the
// model reads the page around the plans' names. Anything that can't be checked is for a person, never a guess.

/** A page's text, or why there's none: robots.txt, an error status, a timeout. */
export type PageResult = { text: string } | { error: string };

/** What the check reads the world with: the Worker's fetch, Browser Rendering and Workers AI, or tests' fakes. */
export interface PageDeps {
  /** A page's text by a plain fetch, as robots.txt allows. */
  page(url: string): Promise<PageResult>;
  /** A page's text in a browser, for one a fetch gets nothing from. */
  browser(url: string): Promise<PageResult>;
  /** Workers AI's answer to a request. */
  extract(request: ExtractionRequest): Promise<unknown>;
  /** A file for the logo search, as robots.txt allows. */
  download: Download;
  /** The committed data/logos/<id>.png, read only when the icon found isn't it. */
  committedLogo(id: string): Promise<Uint8Array | undefined>;
}

export interface CheckInput {
  /** Who it's for, in the pull request: "netflix", "bundle.disney-crave-premium". */
  subject: string;
  targets: PriceTarget[];
  approvals: ApprovalTarget[];
  /** Each region's accepted card networks (BLUEPRINT §9.3). */
  networks: NetworksTarget[];
  /** The provider's or reseller's website, and its committed logo's Git blob hash (none without one). */
  logo?: { id: string; website: string; committed?: string };
  /** The pages policy ratings quote, when they're due (M3.9). */
  policyPages?: PolicyPageTarget[];
  /**
   * Each page's baseline as main has it, or null for a page without one yet (M3.9). A page with a baseline its text
   * still matches is unchanged: its prices are confirmed and its quotes kept, with no model. Pages left out have no
   * baseline check (a night before M3.9).
   */
  baselines?: Readonly<Record<string, Baseline | null>>;
  /** What each page is, and who cites it, for its page finding. */
  cited?: Readonly<Record<string, { type: CitedType; owners: string[] }>>;
}

export interface CheckResult {
  findings: Finding[];
  budget: Budget;
}

export async function checkPages(
  input: CheckInput,
  deps: PageDeps,
  start: Budget,
): Promise<CheckResult> {
  const findings: Finding[] = [];
  const budget = { ...start };
  const pages = new Map<string, PageResult>();
  // One request per URL: a page that several prices or approvals cite is read once.
  const read = async (url: string, names: readonly string[]): Promise<PageResult> => {
    const known = pages.get(url);
    if (known) return known;
    let result: PageResult;
    // A page whose baseline was read in a browser is opened in one again, when tonight's budget allows (M3.9).
    if (input.baselines?.[url]?.method === 'browser' && budget.browserPages > 0) {
      budget.browserPages--;
      result = await deps.browser(url);
      browsed.add(url);
    } else {
      result = await deps.page(url);
      if (budget.browserPages > 0 && needsBrowser(result, names)) {
        budget.browserPages--;
        const rendered = await deps.browser(url);
        if ('text' in rendered || 'error' in result) {
          result = rendered;
          browsed.add(url);
        }
      }
    }
    pages.set(url, result);
    return result;
  };
  /** Whether a page still reads as its baseline: `same`, else undefined (changed, new, or not checked against one). */
  const statuses = new Map<string, { lines: string[]; baseline: Baseline | null }>();
  const unchanged = (url: string, page: PageResult, read: 'fetch' | 'browser'): boolean => {
    if (!input.baselines || !(url in input.baselines) || 'error' in page) return false;
    const baseline = input.baselines[url];
    // Read another way than its baseline (no browser left tonight): not compared, and checked as before M3.9.
    if (baseline && baseline.method !== read) return false;
    const lines = baselineLines(page.text);
    statuses.set(url, { lines, baseline });
    if (!baseline) return false;
    const diff = baselineDiff(baseline.lines, lines);
    return diff.added.length === 0 && diff.removed.length === 0;
  };
  const methodOf = (url: string): 'fetch' | 'browser' => (browsed.has(url) ? 'browser' : 'fetch');
  const browsed = new Set<string>();

  const byUrl = new Map<string, PriceTarget[]>();
  for (const target of input.targets) {
    byUrl.set(target.price.sourceUrl, [...(byUrl.get(target.price.sourceUrl) ?? []), target]);
  }
  for (const [url, targets] of byUrl) {
    const names = targets.flatMap((target) => target.names);
    const page = await read(url, names);
    if ('error' in page) {
      findings.push({ kind: 'manual', subject: label(targets), url, reason: page.error });
      continue;
    }
    // Unchanged since its facts were read: every price on it holds, with no model.
    if (unchanged(url, page, methodOf(url))) {
      for (const target of targets) findings.push({ kind: 'confirmed', target });
      continue;
    }
    const around = excerpt(page.text, nameIndexes(page.text, names));
    const unconfirmed: PriceTarget[] = [];
    for (const target of targets) {
      const { amount, currency, intervalCount, taxIncluded } = target.price;
      // A price for several periods may be shown a period at a time: Mullvad's €30 for 6 months is "€5 /month".
      const shown = (value: number) => pageShows(page.text, value, currency, target.names);
      if (shown(amount) || (intervalCount > 1 && shown(amount / intervalCount))) {
        findings.push({ kind: 'confirmed', target });
      } else {
        unconfirmed.push(target);
      }
      if (taxIncluded) {
        const wording = taxWording(page.text, taxIncluded.quote, around || page.text);
        if (wording.status !== 'kept') {
          findings.push({
            kind: 'tax',
            target,
            reason: wording.status,
            ...(wording.status === 'contradicted' && { wording: wording.wording }),
          });
        }
      }
    }
    if (unconfirmed.length > 0) {
      findings.push(...(await extracted(url, page.text, around, unconfirmed, deps, budget)));
    }
  }

  for (const approval of input.approvals) {
    const page = await read(approval.url, [approval.reseller]);
    if ('error' in page) {
      findings.push({
        kind: 'manual',
        subject: `${approval.provider}'s reseller ${approval.reseller}`,
        url: approval.url,
        reason: page.error,
      });
      continue;
    }
    if (unchanged(approval.url, page, methodOf(approval.url))) continue;
    const missing = missingQuotes(page.text, approval.quotes);
    if (missing.length > 0) findings.push({ kind: 'reseller', approval, missing });
  }

  // A page of accepted networks that several regions cite (Disney+'s help centre) is judged for them together.
  const networksByUrl = new Map<string, NetworksTarget[]>();
  for (const target of input.networks) {
    networksByUrl.set(target.url, [...(networksByUrl.get(target.url) ?? []), target]);
  }
  for (const [url, targets] of networksByUrl) {
    const page = await read(
      url,
      targets.flatMap((target) => target.quotes),
    );
    if ('error' in page) {
      findings.push({
        kind: 'manual',
        subject: targets.map(networksSubject).join(', '),
        url,
        reason: page.error,
      });
      continue;
    }
    if (unchanged(url, page, methodOf(url))) continue;
    findings.push(...networksFindings(page.text, targets));
  }

  // Policy pages (M3.9): a changed one is for a reviewer to grade again, with the ratings' quotes it lost.
  for (const target of input.policyPages ?? []) {
    const page = await read(target.url, []);
    if ('error' in page) {
      findings.push({
        kind: 'manual',
        subject: `${target.provider}'s policies`,
        url: target.url,
        reason: page.error,
      });
      continue;
    }
    if (unchanged(target.url, page, methodOf(target.url))) continue;
    const missing = target.ratings.flatMap((rating) =>
      missingQuotes(page.text, rating.quotes).map((quote) => ({ topic: rating.topic, quote })),
    );
    // A first baseline is no change: only quotes gone from it are.
    if (input.baselines?.[target.url] !== null || missing.length > 0) {
      findings.push({ kind: 'policy', target, missing });
    }
  }

  // Each page that changed, or had no baseline, with its new lines for the digest.
  for (const [url, { lines, baseline }] of statuses) {
    const diff = baseline ? baselineDiff(baseline.lines, lines) : { added: lines, removed: [] };
    if (baseline && diff.added.length === 0 && diff.removed.length === 0) continue;
    const cited = input.cited?.[url];
    findings.push({
      kind: 'page',
      url,
      type: cited?.type ?? 'pricing',
      owners: cited?.owners ?? [input.subject],
      method: methodOf(url),
      lines,
      added: diff.added,
      removed: diff.removed,
      had: baseline !== null,
    });
  }

  if (input.logo) {
    const icon = await findIcon(input.logo.website, deps.download);
    if (icon && (await gitBlobSha(icon.png)) !== input.logo.committed) {
      // Only an icon at least as big as the committed one: a site that keeps the bot from its own icons leaves only the
      // icon services', which are smaller, and that's no rebrand.
      const before =
        input.logo.committed === undefined ? undefined : await deps.committedLogo(input.logo.id);
      const width = before && readIconImage(before)?.width;
      if (input.logo.committed !== undefined && width === undefined) {
        findings.push({
          kind: 'manual',
          subject: `${input.logo.id}'s logo`,
          url: icon.url,
          reason:
            'A new icon was found, but the committed logo couldn’t be read to compare it with',
        });
      } else if (width === undefined || icon.width >= width) {
        findings.push({
          kind: 'logo',
          id: input.logo.id,
          png: toBase64(icon.png),
          width: icon.width,
          source: icon.url,
          replaces: input.logo.committed !== undefined,
        });
      }
    }
  }
  return { findings, budget };
}

/** How the pull request names a region's accepted networks: "netflix's cards in CA". */
function networksSubject(target: NetworksTarget): string {
  return `${target.provider}'s cards in ${target.region}`;
}

/**
 * What a page of accepted card networks says about the regions that cite it: a quote gone takes a region's networks
 * out, for review, and a network the page names beside its quotes that the catalog doesn't list is for review too. A
 * page that follows the reader's country shows one region's list at a time: when another region's quotes are all
 * there, a region's missing ones are another country's list, which a person checks.
 */
export function networksFindings(text: string, targets: readonly NetworksTarget[]): Finding[] {
  const judged = targets.map((target) => ({ target, missing: missingQuotes(text, target.quotes) }));
  const shown = judged.some(({ missing }) => missing.length === 0);
  return judged.flatMap(({ target, missing }): Finding[] => {
    if (missing.length > 0 && shown) {
      return [
        {
          kind: 'manual',
          subject: networksSubject(target),
          url: target.url,
          reason: 'The page shows another country’s list of cards',
        },
      ];
    }
    const named = missing.length > 0 ? [] : namedBeside(text, target);
    return missing.length > 0 || named.length > 0
      ? [{ kind: 'networks', target, missing, named }]
      : [];
  });
}

/**
 * How far each side of a target's quotes the page is read for networks: far enough for one more item in the list
 * they're in, and short of the prose around it ("Discover what's new on Netflix").
 */
const listReach = 40;

/** The networks the page names within reach of the target's quotes (all on the page) that the target doesn't list. */
function namedBeside(text: string, target: NetworksTarget): string[] {
  const page = comparable(text);
  const spans = target.quotes.map((quote) => {
    const wanted = comparable(quote);
    const at = page.indexOf(wanted);
    return { start: at, end: at + wanted.length };
  });
  const from = Math.max(0, Math.min(...spans.map((span) => span.start)) - listReach);
  const to = Math.max(...spans.map((span) => span.end)) + listReach;
  return networksNamedIn(page.slice(from, to)).filter(
    (network) => !target.networks.includes(network),
  );
}

/** Whether a fetched page needs the browser: it failed, or names none of its plans and shows no price at all. */
function needsBrowser(result: PageResult, names: readonly string[]): boolean {
  if ('error' in result) return !result.error.startsWith('robots.txt');
  return nameIndexes(result.text, names).length === 0 && !/\d[.,]\d\d\b/.test(result.text);
}

/** Workers AI's reading of the prices whose stored amount isn't on their page, each judged. */
async function extracted(
  url: string,
  text: string,
  around: string,
  targets: readonly PriceTarget[],
  deps: PageDeps,
  budget: Budget,
): Promise<Finding[]> {
  const request = extractionRequest(around || text.slice(0, 12_000), targets);
  const cost = neuronEstimate(request);
  if (cost > budget.neurons) {
    return [
      {
        kind: 'manual',
        subject: label(targets),
        url,
        reason: 'Not enough Workers AI left tonight to read it',
      },
    ];
  }
  budget.neurons -= cost;
  let answers: (ExtractedPrice | undefined)[];
  try {
    answers = readExtraction(await deps.extract(request), targets.length);
  } catch (error) {
    return [
      {
        kind: 'manual',
        subject: label(targets),
        url,
        reason: `Workers AI failed: ${message(error)}`,
      },
    ];
  }
  return targets.map((target, index) => {
    const answer = answers[index];
    // A price the model reads is taken only with the page's own words for it (M3.9): its quote must be on the page,
    // word for word, and show the amount.
    if (answer?.found && answer.regularAmount !== undefined) {
      const words = answer.quote === undefined ? undefined : findQuote(answer.quote, text);
      const amount = answer.regularAmount;
      if (!words || !moneyIn(words).some((mention) => sameAmount(mention.amount, amount))) {
        return {
          kind: 'manual',
          subject: `${target.label} (${priceText(target.price)})`,
          url,
          reason: 'Workers AI’s quote for its price isn’t on the page word for word',
        } satisfies Finding;
      }
    }
    return judged(target, answer);
  });
}

/** What an answer means for a stored price (§6.4's guardrails). */
export function judged(target: PriceTarget, answer: ExtractedPrice | undefined): Finding {
  const { amount, currency, sourceUrl } = target.price;
  const subject = `${target.label} (${priceText(target.price)})`;
  if (answer?.onlySalePrice) {
    return {
      kind: 'manual',
      subject,
      url: sourceUrl,
      reason: 'The page shows only a sale or first-term price',
    };
  }
  if (!answer?.found || answer.regularAmount === undefined) {
    return { kind: 'manual', subject, url: sourceUrl, reason: 'Its price isn’t on the page' };
  }
  if (
    answer.currency !== undefined &&
    !sameCurrency(answer.currency === '$' ? 'dollar' : answer.currency, currency)
  ) {
    return {
      kind: 'manual',
      subject,
      url: sourceUrl,
      reason: `The page shows ${answer.currency}, not ${currency}: a region or currency mismatch`,
    };
  }
  if (sameAmount(answer.regularAmount, amount)) return { kind: 'confirmed', target };
  const change = Math.abs(answer.regularAmount - amount) / (amount === 0 ? 1 : amount);
  return { kind: 'changed', target, amount: answer.regularAmount, suspicious: change > 0.3 };
}

function label(targets: readonly PriceTarget[]): string {
  return [...new Set(targets.map((target) => target.label))].join(', ');
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
