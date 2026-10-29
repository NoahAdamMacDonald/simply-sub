import { baselinePath, writeBaseline, type IsoDate } from '@simply-sub/core';
import { proposal, type FileChange, type Proposal } from './proposal';
import type { ReportOutcome, ReportOutcomes } from './reports';
import { priceText } from './targets';
import type { Finding } from './types';

// The weekly digest (BLUEPRINT §6.4, M3.9): one pull request of the week's changes on the bot's branch. The clear ones
// are edits (a price that moved, with its page's words; a lastVerified bumped; a new logo; a page that changed with
// nothing to review); the rest go to a review list, review/README.md, committed on the same branch with each page's
// new text as its baseline, so a reviewer needs only GitHub: the pull request's diff of a baseline is what changed.
// The week's price reports (M10.10) are in the body with what their pages showed, the review list when a page
// couldn't be read, and the countries the catalog doesn't price yet are counted for the next regions.

/** The digest's branch: rebuilt from main each week. */
export const digestBranch = 'bot/catalog-digest';

/** The review list's path on the branch. */
export const reviewFile = 'review/README.md';

/** One item of the review list, by section. */
interface ReviewItem {
  section: 'Prices' | 'Policies' | 'Features' | 'Unreadable';
  text: string;
}

/** The digest for `findings` (every pending page's), made from `files` as main has them. */
export function digest(
  findings: readonly Finding[],
  files: ReadonlyMap<string, string>,
  today: IsoDate,
  extra: {
    reviewer: string;
    notes?: readonly string[];
    reviewed?: ReadonlyMap<Finding, readonly string[]>;
    /** What the week's price reports came to (M10.10). */
    reports?: ReportOutcomes;
  } = {
    reviewer: 'manual',
  },
): Proposal {
  const made = proposal(findings, files, today);
  const changes: FileChange[] = [...made.changes];
  const pages = findings.filter(
    (finding): finding is Extract<Finding, { kind: 'page' }> => finding.kind === 'page',
  );
  for (const page of pages) {
    changes.push({
      path: baselinePath(page.url),
      text: writeBaseline({ url: page.url, method: page.method, saved: today, lines: page.lines }),
    });
  }
  const items = [
    ...reviewItems(findings, extra.reviewed ?? new Map()),
    ...reportItems(extra.reports?.outcomes ?? []),
  ];
  // The list is rebuilt each week: last week's, merged with its pull request, is replaced.
  changes.push({
    path: reviewFile,
    text: reviewList(items, today, extra.reviewer, extra.notes ?? []),
  });
  changes.sort((a, b) => (a.path < b.path ? -1 : 1));

  const quiet = pages.filter(
    (page) =>
      !findings.some(
        (finding) =>
          finding !== page && urlOf(finding) === page.url && finding.kind !== 'confirmed',
      ),
  );
  const counts = (['Prices', 'Policies', 'Features', 'Unreadable'] as const)
    .map((section) => [section, items.filter((item) => item.section === section).length] as const)
    .filter(([, count]) => count > 0);
  const body = [
    `The weekly digest of ${today} (BLUEPRINT §6.4): what the nightly checks found since the last one. The clear changes are in this pull request's edits; what needs a person is in [${reviewFile}](../blob/${digestBranch}/${reviewFile})${counts.length > 0 ? ` (${counts.map(([section, count]) => `${section.toLowerCase()} ${count}`).join(', ')})` : ' (nothing this week)'}, reviewed by ${extra.reviewer}. Each changed page's new text is its baseline in data/baselines/, so this pull request's diff of it shows what changed. Nothing is merged by the bot.`,
    made.body.split('\n\n').slice(1).join('\n\n'),
    reportLines(extra.reports?.outcomes ?? []),
    askedRegions(extra.reports?.regions ?? []),
    quiet.length > 0 &&
      `### Pages that changed with nothing to review\n\n${quiet.length === 1 ? 'One page' : `${quiet.length} pages`} changed in ways that touch none of the catalog's facts; their baselines are updated: ${quiet
        .slice(0, 20)
        .map((page) => link(page.url))
        .join(', ')}${quiet.length > 20 ? ` and ${quiet.length - 20} more` : ''}.`,
  ].filter((part): part is string => typeof part === 'string' && part !== '');
  return { title: `Catalog digest ${today}`, body: body.join('\n\n'), changes };
}

/** What a person has to look at, by section: prices first, then policies, then features, then pages not read. */
function reviewItems(
  findings: readonly Finding[],
  reviewed: ReadonlyMap<Finding, readonly string[]>,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const push = (finding: Finding, item: ReviewItem) => {
    // The reviewer's notes, a line each under the item.
    const notes = (reviewed.get(finding) ?? []).map((note) => `\n  - ${cell(note, 600)}`);
    items.push({ ...item, text: `${item.text}${notes.join('')}` });
  };
  const pageOf = (url: string | undefined) =>
    findings.find(
      (finding): finding is Extract<Finding, { kind: 'page' }> =>
        finding.kind === 'page' && finding.url === url,
    );
  const changedLines = (url: string | undefined) => {
    const page = pageOf(url);
    if (!page) return '';
    const lines = [
      ...page.removed.slice(0, 6).map((line) => `    - removed: “${cell(line)}”`),
      ...page.added.slice(0, 6).map((line) => `    - added: “${cell(line)}”`),
    ];
    const more = page.added.length + page.removed.length - lines.length;
    return `\n  - The page: \`${baselinePath(page.url)}\` (its diff in this pull request)${lines.length > 0 ? `\n${lines.join('\n')}` : ''}${more > 0 ? `\n    - and ${more} more lines` : ''}`;
  };
  for (const finding of findings) {
    switch (finding.kind) {
      case 'changed':
        if (finding.suspicious) {
          push(finding, {
            section: 'Prices',
            text: `**${cell(finding.target.label)}** (${priceText(finding.target.price)}): ${finding.target.price.amount} → ${finding.amount} ${finding.target.price.currency}, more than ±30%: the edit is in this pull request, check it against ${link(finding.target.price.sourceUrl)}${changedLines(finding.target.price.sourceUrl)}`,
          });
        }
        break;
      case 'tax':
        push(finding, {
          section: 'Prices',
          text: `**${cell(finding.target.label)}**: its "tax included" ${finding.reason === 'quote-gone' ? 'words are gone from' : `is contradicted by “${cell(finding.wording ?? '')}” on`} ${link(finding.target.price.sourceUrl)}, so \`taxIncluded\` is taken out in this pull request${changedLines(finding.target.price.sourceUrl)}`,
        });
        break;
      case 'reseller':
        push(finding, {
          section: 'Prices',
          text: `**${cell(finding.approval.reseller)}** isn't named as ${cell(finding.approval.provider)}'s reseller on ${link(finding.approval.url)} any more, so its listing is taken out${changedLines(finding.approval.url)}`,
        });
        break;
      case 'networks':
        push(finding, {
          section: 'Prices',
          text: `**${cell(finding.target.provider)}'s cards in ${finding.target.region}**: ${finding.missing.length > 0 ? `“${finding.missing.map(cell).join('”, “')}” gone from ${link(finding.target.url)}` : `${finding.named.map(cell).join(', ')} now named beside them on ${link(finding.target.url)}`}${changedLines(finding.target.url)}`,
        });
        break;
      case 'policy':
        push(finding, {
          section: 'Policies',
          text: `**${cell(finding.target.provider)}'s ${link(finding.target.url)}** changed: grade the ratings that quote it again (${finding.target.ratings.map((rating) => rating.topic).join(', ')})${finding.missing.length > 0 ? `; these quotes are gone: ${finding.missing.map((gone) => `${gone.topic} “${cell(gone.quote)}”`).join('; ')}` : ''}${changedLines(finding.target.url)}`,
        });
        break;
      case 'manual':
        push(finding, {
          section: /polic/i.test(finding.subject)
            ? 'Policies'
            : finding.url
              ? 'Unreadable'
              : 'Prices',
          text: `**${cell(finding.subject)}**: ${cell(finding.reason)}${finding.url ? ` ${link(finding.url)}` : ''}${changedLines(finding.url)}`,
        });
        break;
      case 'page':
      case 'confirmed':
      case 'logo':
        break;
    }
  }
  return items;
}

/** The reports whose page couldn't be read: a person checks the price on its page. */
function reportItems(outcomes: readonly ReportOutcome[]): ReviewItem[] {
  return outcomes
    .filter((outcome) => outcome.shown === 'unread')
    .map((outcome) => ({
      section: 'Prices',
      text: `${reported(outcome)}, and ${outcome.urls.length > 0 ? `its page couldn't be read this week: check ${outcome.urls.map(link).join(', ')} by hand, and change the price if it says so` : "its price has no page the bot can read: check it on the provider's site"}`,
    }));
}

/** The reports whose page answered, for the body: a new price (its edit is in the pull request) or the catalog's. */
function reportLines(outcomes: readonly ReportOutcome[]): string | undefined {
  const answered = outcomes.filter((outcome) => outcome.shown !== 'unread');
  if (answered.length === 0) return undefined;
  const shown = (outcome: ReportOutcome) =>
    outcome.shown === 'new'
      ? `Its page shows ${outcome.prices.join(', ')}: the edit is in this pull request.`
      : outcome.shown === 'same'
        ? `Its page still shows the catalog's ${outcome.prices.join(', ')}: nothing to review.`
        : "The catalog doesn't have the plan any more.";
  return `### Price reports\n\nWhat visitors reported with "Report a wrong price", and what the page showed (a page that couldn't be read is in the review list):\n\n${answered.map((outcome) => `- ${reported(outcome)}. ${shown(outcome)}`).join('\n')}`;
}

/** The countries people reported from that the catalog doesn't price the plans in yet, for the next regions. */
function askedRegions(regions: ReportOutcomes['regions']): string | undefined {
  if (regions.length === 0) return undefined;
  return `### Regions people asked about\n\nReports from countries the catalog doesn't price these plans in yet, for the regions to add (PROJECT-PLAN M10.13): ${regions.map((region) => `${region.country} ${region.count} (${region.plans.map((plan) => `${cell(plan.label)} ${plan.count}`).join(', ')})`).join('; ')}.`;
}

/** "**Netflix Standard** in CA: 3 reports of 20.99 CAD monthly (2026-10-27 to 2026-10-28)". */
function reported(outcome: ReportOutcome): string {
  const days =
    outcome.first === outcome.last ? outcome.first : `${outcome.first} to ${outcome.last}`;
  return `**${cell(outcome.label)}** in ${outcome.country}: ${outcome.said} (${days})`;
}

function reviewList(
  items: readonly ReviewItem[],
  today: IsoDate,
  reviewer: string,
  notes: readonly string[],
): string {
  const sections = (['Prices', 'Policies', 'Features', 'Unreadable'] as const).flatMap(
    (section) => {
      const own = items.filter((item) => item.section === section);
      return own.length > 0
        ? [`## ${section}\n\n${own.map((item) => `- [ ] ${item.text}`).join('\n')}`]
        : [];
    },
  );
  return [
    `# Catalog review, ${today}`,
    '',
    `What the nightly checks couldn't settle this week (BLUEPRINT §6.4), for ${reviewer}. Prices first, then policies, then features. For each item, read the page's new text (its baseline in this pull request), change the provider file on this branch if the page says so, with its words quoted, and tick the item with a line saying what was done. Nothing here is merged by the bot.`,
    '',
    ...(notes.length > 0 ? [...notes, ''] : []),
    sections.length > 0 ? sections.join('\n\n') : 'Nothing to review this week.',
    '',
  ].join('\n');
}

/** The page a finding is about. */
export function urlOf(finding: Finding): string | undefined {
  switch (finding.kind) {
    case 'changed':
    case 'confirmed':
    case 'tax':
      return finding.target.price.sourceUrl;
    case 'reseller':
      return finding.approval.url;
    case 'networks':
    case 'policy':
      return finding.target.url;
    case 'page':
      return finding.url;
    case 'manual':
      return finding.url;
    case 'logo':
      return undefined;
  }
}

function cell(text: string, max = 160): string {
  const flat = text
    .replace(/\s+/g, ' ')
    .replace(/[|`<>]/g, (character) => `\\${character}`)
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}…` : flat;
}

function link(url: string): string {
  let shown = url;
  try {
    const parsed = new URL(url);
    shown = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    // shown as it is
  }
  return `[${cell(shown)}](${url.replace(/[()\s]/g, encodeURIComponent)})`;
}
