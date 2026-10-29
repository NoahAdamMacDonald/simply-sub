import { baselinePath, writeBaseline, type IsoDate } from '@simply-sub/core';
import { proposal, type FileChange, type Proposal } from './proposal';
import { priceText } from './targets';
import type { Finding } from './types';

// The weekly digest (BLUEPRINT §6.4, M3.9): one pull request of the week's changes on the bot's branch. The clear ones
// are edits (a price that moved, with its page's words; a lastVerified bumped; a new logo; a page that changed with
// nothing to review); the rest go to a review list, review/README.md, committed on the same branch with each page's
// new text as its baseline, so a reviewer needs only GitHub: the pull request's diff of a baseline is what changed.

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
  const items = reviewItems(findings, extra.reviewed ?? new Map());
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
