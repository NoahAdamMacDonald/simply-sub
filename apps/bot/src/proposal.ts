import { daysBetween } from '@simply-sub/core';
import { priceText } from './targets';
import type { Finding, PriceTarget } from './types';
import {
  withLastVerified,
  withPrice,
  withoutAcceptedNetworks,
  withoutReseller,
  withoutTaxIncluded,
  type PriceLocation,
} from './yaml-edit';

// The pull request a night's findings make (BLUEPRINT §6.4): the files it changes and what it says. Each finding is a
// change for review, and nothing is merged by the bot.

/** A price confirmed this long after it was last verified gets today's date (the user's choice in M8.3). */
export const confirmAfterDays = 30;

export interface FileChange {
  path: string;
  /** A text file's new content. */
  text?: string;
  /** A binary file's, in base64. */
  base64?: string;
}

export interface Proposal {
  title: string;
  body: string;
  changes: FileChange[];
}

/** The text files the findings change, which the pull request step reads from the base branch. */
export function filesToRead(findings: readonly Finding[], today: string): string[] {
  const paths = new Set<string>();
  for (const finding of findings) {
    if (finding.kind === 'changed' || finding.kind === 'tax') paths.add(finding.target.file);
    if (finding.kind === 'confirmed' && stale(finding.target, today))
      paths.add(finding.target.file);
    if (finding.kind === 'reseller') paths.add(finding.approval.file);
    if (finding.kind === 'networks' && finding.missing.length > 0) paths.add(finding.target.file);
  }
  return [...paths].sort();
}

/** The pull request for `findings`, made from `files` as the base branch has them, on `today`. */
export function proposal(
  findings: readonly Finding[],
  files: ReadonlyMap<string, string>,
  today: string,
): Proposal {
  const texts = new Map(files);
  const lost: Finding[] = [];
  const edit = (path: string, change: (text: string) => string | undefined, finding: Finding) => {
    const text = texts.get(path);
    const changed = text === undefined ? undefined : change(text);
    if (changed === undefined) {
      lost.push(finding);
      return false;
    }
    texts.set(path, changed);
    return true;
  };
  const changes: FileChange[] = [];
  const rows: string[] = [];
  const review: string[] = [];
  const logos: string[] = [];
  const manual: string[] = [];
  const unchecked = new Map<string, { reason: string; url?: string; subjects: string[] }>();
  let confirmed = 0;
  let bumped = 0;

  for (const finding of findings) {
    switch (finding.kind) {
      case 'changed': {
        const { target } = finding;
        if (
          edit(target.file, (text) => withPrice(text, at(target), finding.amount, today), finding)
        ) {
          rows.push(changeRow(target, finding.amount, finding.suspicious));
        }
        break;
      }
      case 'confirmed':
        confirmed++;
        if (
          stale(finding.target, today) &&
          edit(
            finding.target.file,
            (text) => withLastVerified(text, at(finding.target), today),
            finding,
          )
        ) {
          bumped++;
        }
        break;
      case 'tax': {
        const { target } = finding;
        if (edit(target.file, (text) => withoutTaxIncluded(text, at(target), today), finding)) {
          const why =
            finding.reason === 'quote-gone'
              ? `its quote “${cell(target.price.taxIncluded?.quote ?? '')}” isn’t on the page any more`
              : `the page now says “${cell(finding.wording ?? '')}” near it`;
          review.push(
            `- **${cell(target.label)}** (${priceText(target.price)}): ${why}, so \`taxIncluded\` is removed. ${link(target.price.sourceUrl)}`,
          );
        }
        break;
      }
      case 'reseller': {
        const { approval } = finding;
        if (edit(approval.file, (text) => withoutReseller(text, approval.reseller), finding)) {
          review.push(
            `- **${cell(approval.reseller)}** isn’t named as ${cell(approval.provider)}’s reseller any more: ${finding.missing
              .map((quote) => `“${cell(quote)}”`)
              .join(', ')} isn’t on ${link(approval.url)}, so its listing is removed.`,
          );
        }
        break;
      }
      case 'networks': {
        const { target } = finding;
        const cards = `**${cell(target.provider)}**’s cards in ${target.region}`;
        if (finding.missing.length === 0) {
          review.push(
            `- ${cards}: ${link(target.url)} now also names ${finding.named.map(cell).join(', ')} beside them. Add it with the page’s words if it takes it.`,
          );
        } else if (
          edit(target.file, (text) => withoutAcceptedNetworks(text, target.region), finding)
        ) {
          review.push(
            `- ${cards}: ${finding.missing
              .map((quote) => `“${cell(quote)}”`)
              .join(
                ', ',
              )} isn’t on ${link(target.url)} any more, so the region’s networks are removed: every card is allowed there until they’re read again.`,
          );
        }
        break;
      }
      case 'logo':
        changes.push({ path: `data/logos/${finding.id}.png`, base64: finding.png });
        logos.push(
          `- **${cell(finding.id)}**: ${finding.replaces ? 'a new' : 'a first'} ${finding.width}×${finding.width} icon from ${link(finding.source)}.`,
        );
        break;
      case 'manual': {
        // A page's prices that fail the same way are one line, not dozens.
        const key = `${finding.url ?? ''} ${finding.reason}`;
        const group = unchecked.get(key);
        if (group) group.subjects.push(finding.subject);
        else
          unchecked.set(key, {
            reason: finding.reason,
            url: finding.url,
            subjects: [finding.subject],
          });
        break;
      }
    }
  }
  for (const { reason, url, subjects } of unchecked.values()) {
    const named =
      subjects.length === 1
        ? `**${cell(subjects[0])}**`
        : `**${subjects.length} of them** (${cell(subjects.slice(0, 4).join('; '))}${subjects.length > 4 ? `; and ${subjects.length - 4} more` : ''})`;
    manual.push(`- ${named}: ${cell(reason)}${url ? ` ${link(url)}` : ''}`);
  }
  for (const finding of lost) {
    const subject =
      finding.kind === 'reseller'
        ? `${finding.approval.provider}’s reseller ${finding.approval.reseller}`
        : finding.kind === 'networks'
          ? `${finding.target.provider}’s cards in ${finding.target.region}`
          : 'target' in finding && finding.target && 'label' in finding.target
            ? finding.target.label
            : 'A change';
    manual.push(
      `- **${cell(subject)}**: its entry couldn’t be found in the file, so it wasn’t changed`,
    );
  }

  for (const [path, text] of texts) {
    if (files.get(path) !== text) changes.push({ path, text });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : 1));

  const sections = [
    `The nightly price check of ${today} (BLUEPRINT §6.4). Check each change against its source before merging: the bot never merges, and a price is never a sale price.`,
    rows.length > 0 &&
      [
        '### Price changes',
        '',
        '| | Price | Was | Now | Source |',
        '|---|---|---|---|---|',
        ...rows,
      ].join('\n'),
    review.length > 0 && ['### For review', '', ...review].join('\n'),
    logos.length > 0 && ['### Logos', '', ...logos].join('\n'),
    manual.length > 0 && ['### Needs manual check', '', ...manual].join('\n'),
    confirmed > 0 &&
      `### Confirmed\n\n${confirmed === 1 ? '1 price is' : `${confirmed} prices are`} still on ${confirmed === 1 ? 'its page' : 'their pages'}${bumped > 0 ? `; ${bumped} last verified ${confirmAfterDays} or more days ago ${bumped === 1 ? 'gets' : 'get'} today’s \`lastVerified\`` : ''}.`,
  ].filter((section) => typeof section === 'string');
  return { title: `Price updates ${today}`, body: sections.join('\n\n'), changes };
}

function at(target: PriceTarget): PriceLocation {
  return { owner: target.owner, price: target.price };
}

/**
 * Whether a finding has something for the digest (M3.9): every kind does, but a price confirmed on its page only when
 * its lastVerified is old enough to be bumped.
 */
export function worthProposing(finding: Finding, today: string): boolean {
  return finding.kind !== 'confirmed' || stale(finding.target, today);
}

function stale(target: PriceTarget, today: string): boolean {
  return daysBetween(target.price.lastVerified, today) >= confirmAfterDays;
}

function changeRow(target: PriceTarget, amount: number, suspicious: boolean): string {
  const was = target.price.amount;
  const percent =
    was === 0 ? '' : ` (${amount > was ? '+' : ''}${(((amount - was) / was) * 100).toFixed(1)}%)`;
  return `| ${suspicious ? '⚠️ over ±30%' : ''} | ${cell(target.label)}, ${priceText(target.price)} | ${was} ${target.price.currency} | ${amount} ${target.price.currency}${percent} | ${link(target.price.sourceUrl)} |`;
}

/** Text for a table cell or a line: no pipes or line breaks, and not too long. Pages' words are only ever quoted. */
function cell(text: string): string {
  const flat = text
    .replace(/\s+/g, ' ')
    .replace(/[|`<>]/g, (character) => `\\${character}`)
    .trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
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
