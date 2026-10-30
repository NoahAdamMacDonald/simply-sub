import { quoteLink } from '../catalog/plan-policies';
import type { Price } from '../catalog/price';
import type { DraftProvider, Evidence, ExtractionIssue, ProposedFeature } from './extraction';
import type { PageKind } from './find-pages';
import { regionWords, type RegionalPrice } from './regional-draft';

// The pull request of a batch of new providers (BLUEPRINT §6.5 ⑥, M3.5): a table to review them by, each provider's
// plans and prices with links that open each price's page at its quote, what was dropped, what to check, the proposed
// features, and the services left out with why. A hidden line lists the batch's queue ids, so the next batch knows
// which are in an open pull request and which a closed one rejected.

/** A provider of the batch, drafted or left out. */
export interface BatchProvider {
  id: string;
  name: string;
  website: string;
  /** drafted: in this pull request; the rest are left out, with a note. */
  status: 'drafted' | 'out-of-scope' | 'unreadable' | 'needs-fix';
  note?: string;
  provider?: DraftProvider;
  pages: { kind: PageKind; url: string }[];
  issues: ExtractionIssue[];
  proposedFeatures: ProposedFeature[];
  evidence: Evidence[];
  /** Its logo: data/logos/<id>.png's size, or none (the app shows a letter). */
  logo?: string;
}

/** The line a batch's pull request hides its queue ids in. */
export const batchMarker = 'simply-sub-batch:';

/** The queue ids a batch's pull request names in its hidden line. */
export function batchIdsIn(body: string): string[] {
  const line = new RegExp(`<!--\\s*${batchMarker}\\s*([^>]*?)\\s*-->`).exec(body);
  return line ? line[1].split(/\s+/).filter(Boolean) : [];
}

/** The most a pull request's body holds (GitHub's limit is 65,536 characters). */
const maxBody = 60_000;

export function batchReview(
  batch: readonly BatchProvider[],
  options: { date: string; extractor: string },
): string {
  const drafted = batch.filter((entry) => entry.status === 'drafted' && entry.provider);
  const left = batch.filter((entry) => entry.status !== 'drafted' || !entry.provider);
  const intro = `A batch of the discovery pipeline (BLUEPRINT §6.5), read on ${options.date} and extracted by ${options.extractor}. Every price, feature, card network and policy rating below is quoted from the provider's own pages, checked word for word; anything that wasn't is listed as dropped. Check each against its page before merging: nothing is merged by the pipeline.`;
  const table = [
    '| Provider | Plans | Prices | Proposed features | Dropped | To check |',
    '|---|---|---|---|---|---|',
    ...drafted.map((entry) => {
      const provider = entry.provider as DraftProvider;
      const dropped = entry.issues.filter((issue) => issue.kind === 'dropped').length;
      const check = entry.issues.filter((issue) => issue.kind === 'warning').length;
      return `| **${cell(entry.name)}** | ${provider.plans.length} | ${cell(priceSummary(provider))} | ${entry.proposedFeatures.length || '–'} | ${dropped || '–'} | ${check || '–'} |`;
    }),
  ].join('\n');
  const sections = drafted.map((entry) => providerSection(entry));
  const leftOut =
    left.length > 0
      ? [
          '## Left out',
          '',
          ...left.map(
            (entry) =>
              `- **${cell(entry.name)}** (${cell(entry.website)}): ${statusWords[entry.status]}${entry.note ? `: ${cell(entry.note)}` : ''}`,
          ),
        ].join('\n')
      : '';
  const marker = `<!-- ${batchMarker} ${batch.map((entry) => entry.id).join(' ')} -->`;
  let body = [
    intro,
    drafted.length > 0 ? table : 'No provider was drafted.',
    ...sections,
    leftOut,
    marker,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
  if (body.length > maxBody) {
    body = `${body.slice(0, maxBody - marker.length - 120)}\n\n…cut to fit: each provider's file has its sources in its header.\n\n${marker}`;
  }
  return body;
}

const statusWords: Record<BatchProvider['status'], string> = {
  drafted: 'drafted',
  'out-of-scope': 'not a personal or family subscription',
  unreadable: "its pages couldn't be read",
  'needs-fix': 'its draft needs a fix first',
};

function providerSection(entry: BatchProvider): string {
  const provider = entry.provider as DraftProvider;
  const lines = [`### ${entry.name}`, ''];
  lines.push(
    `- **Pages read:** ${entry.pages.map((page) => `[${page.kind}](${linkTarget(page.url)})`).join(', ') || 'none'}`,
  );
  lines.push(`- **Logo:** ${entry.logo ?? 'none: the app shows a letter'}`);
  for (const plan of provider.plans) {
    const prices = plan.prices.map((price) => {
      const quote = entry.evidence.find(
        (evidence) =>
          evidence.url === price.sourceUrl &&
          evidence.subject.startsWith(
            `${plan.name}, ${price.region} ${price.amount} ${price.currency}`,
          ),
      );
      const words = `${priceWords(price)}`;
      return quote ? `[${words}](${linkTarget(quoteLink(quote.url, [quote.quote]))})` : words;
    });
    const features = Object.entries(plan.features)
      .map(([id, value]) => `${id}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
      .join('; ');
    lines.push(
      `- **${cell(plan.name)}:** ${prices.join(' · ')}${features ? `. ${cell(features)}` : ''}`,
    );
  }
  if (provider.acceptedNetworks) {
    lines.push(
      `- **Cards:** ${Object.entries(provider.acceptedNetworks)
        .map(([region, accepted]) => `${region} ${accepted.networks.join(', ')}`)
        .join('; ')}`,
    );
  }
  if (provider.resellers) {
    lines.push(
      '- **Official resellers** (named on its own page, at their regular prices):',
      ...provider.resellers.map(
        (listing) =>
          `  - ${cell(listing.reseller)}: ${listing.offers
            .flatMap((offer) =>
              offer.prices.map((price) => `[${priceWords(price)}](${linkTarget(price.sourceUrl)})`),
            )
            .join(
              ' · ',
            )}; named “${cell(listing.approvedBy.quotes.join('”, “'))}” on [its page](${linkTarget(quoteLink(listing.approvedBy.url, listing.approvedBy.quotes))})`,
      ),
    );
  }
  if (provider.policies) lines.push(`- **Policies:** ${provider.policies.ratings.length} rated`);
  if (entry.proposedFeatures.length > 0) {
    lines.push(
      '- **Proposed features** (for your approval, through the feature-discovery skill):',
      ...entry.proposedFeatures.map(
        (proposal) =>
          `  - ${cell(proposal.name)}: ${cell(proposal.description)}, “${cell(proposal.quote)}” ([page](${linkTarget(quoteLink(proposal.url, [proposal.quote]))}))`,
      ),
    );
  }
  const dropped = entry.issues.filter((issue) => issue.kind === 'dropped');
  if (dropped.length > 0) {
    lines.push(
      '- **Dropped:**',
      ...dropped.map(
        (issue) =>
          `  - ${cell(issue.subject)}: ${cell(issue.reason)}${issue.quote ? ` (“${cell(issue.quote)}”)` : ''}`,
      ),
    );
  }
  const check = entry.issues.filter((issue) => issue.kind === 'warning');
  if (check.length > 0) {
    lines.push(
      '- **To check:**',
      ...check.map((issue) => `  - ${cell(issue.subject)}: ${cell(issue.reason)}`),
    );
  }
  return lines.join('\n');
}

/** A provider of a region's batch (M10.12): the prices added for it, and why any of its pages or prices weren't. */
export interface RegionalBatchProvider {
  id: string;
  name: string;
  /** Each price added, with its plan's name. */
  added: (RegionalPrice & { planName: string })[];
  /** Why the provider (or some of its prices) was left out: no page found, a page unread, a price dropped. */
  notes: string[];
}

/**
 * The pull request of a region's batch (BLUEPRINT §6.5, M10.12): each price added with a link that opens its page at
 * its quote, then the providers left out with why, so a reviewer checks each against the provider's own page.
 */
export function regionalReview(
  region: string,
  providers: readonly RegionalBatchProvider[],
): string {
  const name = regionWords(region);
  const added = providers.filter((provider) => provider.added.length > 0);
  const left = providers.filter((provider) => provider.added.length === 0);
  const prices = added.reduce((sum, provider) => sum + provider.added.length, 0);
  const rows = added.flatMap((provider) =>
    provider.added.map(
      (entry) =>
        `| ${cell(provider.name)} | ${cell(entry.planName)} | ${priceWords(entry.price)} | [${cell(entry.quote)}](${linkTarget(quoteLink(entry.price.sourceUrl ?? '', [entry.quote]))}) |`,
    ),
  );
  const notes = (provider: RegionalBatchProvider) =>
    provider.notes.map((note) => `  - ${cell(note)}`).join('\n');
  return [
    `Prices for ${name} (${region}), read from each provider's own page for ${name} by the discovery pipeline (BLUEPRINT §6.5, PROJECT-PLAN M10.12): every price is its regular one, quoted word for word from its page, which each link opens at the quote. Nothing is merged by the bot: check each against its page.`,
    `### Added: ${prices === 1 ? '1 price' : `${prices} prices`} for ${added.length === 1 ? '1 provider' : `${added.length} providers`}`,
    rows.length > 0
      ? ['| Provider | Plan | Price | Quote |', '|---|---|---|---|', ...rows].join('\n')
      : 'None.',
    ...added
      .filter((provider) => provider.notes.length > 0)
      .map((provider) => `**${cell(provider.name)}** also:\n${notes(provider)}`),
    `### Left out: ${left.length === 1 ? '1 provider' : `${left.length} providers`}`,
    left.length > 0
      ? left.map((provider) => `- **${cell(provider.name)}**\n${notes(provider)}`).join('\n')
      : 'None.',
  ].join('\n\n');
}

/** "18.99 CAD a month", "99 USD every 2 years". */
function priceWords(price: Price): string {
  const period =
    price.intervalCount === 1
      ? { day: 'a day', week: 'a week', month: 'a month', year: 'a year' }[price.interval]
      : `every ${price.intervalCount} ${price.interval}s`;
  return `${price.amount === 0 ? 'free' : `${price.amount} ${price.currency} ${period}`} (${price.region})`;
}

/** Each plan's first price, for the table. */
function priceSummary(provider: DraftProvider): string {
  return provider.plans
    .map((plan) => `${plan.name} ${plan.prices[0] ? priceWords(plan.prices[0]) : ''}`)
    .join(' · ');
}

/** Text for a table cell or a line: no pipes or line breaks, not too long. Pages' words are only ever quoted. */
function cell(text: string): string {
  const flat = text
    .replace(/\s+/g, ' ')
    .replace(/[|`<>]/g, (character) => `\\${character}`)
    .trim();
  return flat.length > 200 ? `${flat.slice(0, 197)}…` : flat;
}

function linkTarget(url: string): string {
  return url.replace(/[()\s]/g, encodeURIComponent);
}
