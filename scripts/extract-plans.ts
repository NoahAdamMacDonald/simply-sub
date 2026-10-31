// Drafts a provider file from its saved pages (BLUEPRINT §6.5 ④ and ⑤, M3.4). A model reads the pages render-pages
// saved and answers in core's extraction schema; core's draftFromAnswer checks every quote against the pages (a fact
// whose quote isn't there is dropped), the prices' plausibility, the features against features.yaml (anything else is
// a proposed feature), and drafts the file, which data:validate then checks with the rest of the catalog.
//
//   npm run data:extract -- claude --prepare            writes .pipeline/claude/extraction.md, the request, for a
//                                                       session's model (Claude) to answer in .pipeline/claude/answer.json
//   npm run data:extract -- claude                      checks answer.json and writes data/providers/claude.yaml
//   npm run data:extract -- claude --model workers-ai   asks Workers AI (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN
//                                                       in .env: a token with Workers AI read), then as above
//   npm run data:extract -- netflix --region GB [--prepare | --model workers-ai]
//                                                       a region's prices for a provider the catalog has (M10.12), from
//                                                       the pages read for it (.pipeline/<id>/regions/GB/): only those
//                                                       prices are added to its file, each quoted on its page
import {
  draftFromAnswer,
  draftYaml,
  extractionAnswerSchema,
  extractionParts,
  extractionPrompt,
  featuresFileSchema,
  formatCatalogIssue,
  mergeAnswers,
  pageKinds,
  policyTopicsFileSchema,
  resellersFileSchema,
  queueFileSchema,
  readModelAnswer,
  regionalAnswerSchema,
  regionalPriceText,
  regionalPrices,
  regionalPrompt,
  baselineLines,
  providerSchema,
  moneyIn,
  servedCovers,
  toIsoDate,
  workersAiModel,
  type ExtractionAnswer,
  type ExtractionContext,
  type ExtractionPage,
  type PageKind,
  type RegionalAnswer,
  type RegionalContext,
  type Reseller,
} from '@simply-sub/core';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { isMap, isSeq, parse, parseDocument, type Document } from 'yaml';
import { checkCatalog, loadCatalogFiles, plural } from './lib/catalog-files';
import {
  absolute,
  readJson,
  workFile,
  workId,
  writeJson,
  type FoundUrls,
  type PageRecord,
} from './lib/pipeline-files';
import { loadDotEnv } from './lib/search';

const args = process.argv.slice(2);
const [id] = args.filter(
  (arg, index) => !arg.startsWith('--') && !['--model', '--region'].includes(args[index - 1] ?? ''),
);
if (!id) fail('Name the provider: npm run data:extract -- <id> [--prepare | --model workers-ai]');
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined;
if (model !== undefined && model !== 'workers-ai') fail('--model takes workers-ai');
const region = args.includes('--region') ? args[args.indexOf('--region') + 1] : undefined;
if (region !== undefined) {
  await regional(id, region);
  process.exit();
}

const context = await contextFor(id);
if (args.includes('--prepare')) {
  const file = workFile(id, 'extraction.md');
  await writeFile(absolute(file), extractionPrompt(context));
  console.log(
    `Wrote ${file}: ${plural(context.pages.length, 'page')}. Answer it in ${workFile(id, 'answer.json')}, then run npm run data:extract -- ${id}.`,
  );
  process.exit(0);
}

const answer = model === 'workers-ai' ? await askWorkersAi(context) : await readAnswer(id);
await writeJson(workFile(id, 'answer.json'), answer);
const draft = draftFromAnswer(answer, context);
await writeJson(workFile(id, 'report.json'), {
  outOfScope: draft.outOfScope,
  issues: draft.issues,
  proposedFeatures: draft.proposedFeatures,
  evidence: draft.evidence,
});
for (const issue of draft.issues) {
  console.log(
    `${issue.kind === 'dropped' ? 'Dropped' : 'Check'}: ${issue.subject}: ${issue.reason}${issue.quote ? ` ("${issue.quote.slice(0, 80)}")` : ''}`,
  );
}
for (const proposal of draft.proposedFeatures) {
  console.log(
    `Proposed feature: ${proposal.name}: ${proposal.description} ("${proposal.quote.slice(0, 80)}")`,
  );
}
if (draft.outOfScope) {
  console.log(
    `Out of scope: ${draft.outOfScope}. No file written; the batch marks it in data/queue.yaml.`,
  );
} else if (!draft.provider) {
  console.log('No file written: nothing held up (see above).');
  process.exitCode = 1;
} else {
  const file = `data/providers/${id}.yaml`;
  const text = draftYaml(draft.provider, { header: draft.comments });
  await writeFile(
    absolute(file),
    await format(text, { ...(await resolveConfig(absolute(file))), filepath: absolute(file) }),
  );
  await addResellers(draft.newResellers);
  const { issues } = await checkCatalog();
  const own = issues.filter(({ issue }) => issue.file === file);
  for (const { issue, line } of own)
    console.log(
      `${issue.severity === 'error' ? 'Error' : 'Warning'}: ${formatCatalogIssue(issue, line)}`,
    );
  console.log(
    `Wrote ${file}: ${plural(draft.provider.plans.length, 'plan')}, ${plural(draft.issues.filter((issue) => issue.kind === 'dropped').length, 'dropped fact')}, ${plural(own.filter(({ issue }) => issue.severity === 'error').length, 'validation error')}.`,
  );
  if (own.some(({ issue }) => issue.severity === 'error')) process.exitCode = 1;
}

/** The provider, its saved pages, the registry and the policy topics. */
async function contextFor(provider: string): Promise<ExtractionContext> {
  const queue = queueFileSchema.parse(
    parse(await readFile(absolute('data/queue.yaml'), 'utf8')) ?? [],
  );
  const found = await readJson<FoundUrls>(workFile(provider, 'urls.json'));
  const entry = queue.find((candidate) => candidate.id === provider);
  if (!entry) fail(`"${provider}" isn't in data/queue.yaml: add it there first.`);
  const { pages } = await pagesIn(provider);
  if (pages.length === 0)
    fail(`No pages saved for ${provider}: run npm run data:urls and data:render first.`);
  const { sources } = await loadCatalogFiles();
  const data = (file: string) => {
    const source = sources.find((candidate) => candidate.file === file);
    return source && 'data' in source ? source.data : undefined;
  };
  return {
    provider: {
      id: provider,
      name: entry.name,
      website: entry.website,
      ...(found?.domains && { domains: found.domains }),
      category: entry.category,
    },
    pages,
    features: featuresFileSchema.parse(data('data/features.yaml')),
    topics: policyTopicsFileSchema.parse(data('data/policy-topics.yaml') ?? []),
    resellers: resellersFileSchema.parse(data('data/resellers.yaml') ?? []),
    today: toIsoDate(new Date()),
  };
}

/**
 * The pages saved in a working folder, as the extraction reads them; and those read for a region that turned out to be
 * another's (render-pages' unread), left out with why.
 */
async function pagesIn(
  work: string,
): Promise<{ pages: ExtractionPage[]; unread: { name: string; reason: string }[] }> {
  const pages: ExtractionPage[] = [];
  const unread: { name: string; reason: string }[] = [];
  const folder = absolute(workFile(work, 'pages'));
  const names = (await readdir(folder).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.json'))
    .sort();
  for (const name of names) {
    const record = JSON.parse(await readFile(`${folder}/${name}`, 'utf8')) as
      PageRecord | { error: string };
    if ('error' in record) continue;
    if (!(pageKinds as readonly string[]).includes(record.kind)) continue;
    if (record.unread) {
      unread.push({ name: name.slice(0, -'.json'.length), reason: record.unread });
      continue;
    }
    pages.push({
      name: name.slice(0, -'.json'.length),
      kind: record.kind as PageKind,
      url: record.finalUrl,
      text: [
        record.renderedText,
        ...record.views.map((view) => `--- after clicking "${view.label}" ---\n${view.text}`),
      ].join('\n\n'),
    });
    // A page its scripts change (Claude's prices in Canada's dollars) has other words as served: its own page, when
    // it has a line with an amount the page as shown doesn't.
    const shown = new Set(baselineLines(record.renderedText));
    const priced = baselineLines(record.servedText).some(
      (line) => !shown.has(line) && moneyIn(line).some((mention) => mention.currency !== undefined),
    );
    if (
      priced ||
      (record.servedText.length >= 400 && !servedCovers(record.servedText, record.renderedText))
    ) {
      pages.push({
        name: `${name.slice(0, -'.json'.length)}-served`,
        kind: record.kind as PageKind,
        url: record.finalUrl,
        text: record.servedText,
      });
    }
  }
  return { pages, unread };
}

/**
 * A region's prices for a provider the catalog has (M10.12). With --prepare, the request for the pages read for the
 * region (regions/<region>/extraction.md); else its answer (answer.json there, or Workers AI's) is checked by core's
 * regionalPrices, and the prices kept go into data/providers/<id>.yaml beside the others, each replacing the plan's
 * price for that region and period. What was kept and dropped is in regions/<region>/report.json, for the batch.
 */
async function regional(provider: string, where: string): Promise<void> {
  const work = workId(provider, where);
  const file = `data/providers/${provider}.yaml`;
  const text = await readFile(absolute(file), 'utf8').catch(() =>
    fail(`No ${file}: a region's prices go into a provider the catalog has.`),
  );
  const own = providerSchema.parse(parse(text));
  const { pages, unread } = await pagesIn(work);
  for (const page of unread) console.log(`Unread: ${page.name}: ${page.reason}`);
  const regional: RegionalContext = {
    provider: {
      id: provider,
      name: own.name,
      plans: own.plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        ...(plan.formerNames && { formerNames: plan.formerNames }),
        prices: plan.prices,
      })),
    },
    region: where,
    pages: pages.filter((page) => page.kind === 'pricing'),
  };
  if (regional.pages.length === 0) {
    await writeJson(workFile(work, 'report.json'), {
      region: where,
      unread,
      prices: [],
      issues: [],
    });
    fail(
      `No pricing page for ${provider} in ${where} to read: run npm run data:urls and data:render with --region ${where} first.`,
    );
  }
  if (args.includes('--prepare')) {
    const request = workFile(work, 'extraction.md');
    await writeFile(absolute(request), regionalPrompt(regional));
    console.log(
      `Wrote ${request}: ${plural(regional.pages.length, 'page')}. Answer it in ${workFile(work, 'answer.json')}, then run npm run data:extract -- ${provider} --region ${where}.`,
    );
    return;
  }
  const answer =
    model === 'workers-ai'
      ? await askWorkersAiRegional(regional)
      : await readRegionalAnswer(workFile(work, 'answer.json'), workFile(work, 'extraction.md'));
  await writeJson(workFile(work, 'answer.json'), answer);
  const { prices, issues } = regionalPrices(answer, regional, toIsoDate(new Date()));
  await writeJson(workFile(work, 'report.json'), { region: where, unread, prices, issues });
  for (const issue of issues) {
    console.log(
      `${issue.kind === 'dropped' ? 'Dropped' : 'Check'}: ${issue.subject}: ${issue.reason}${issue.quote ? ` ("${issue.quote.slice(0, 80)}")` : ''}`,
    );
  }
  if (prices.length === 0) {
    console.log(`No prices for ${where} held up: ${file} is unchanged.`);
    process.exitCode = 1;
    return;
  }
  const doc = parseDocument(text);
  for (const { plan, price } of prices) {
    const index = own.plans.findIndex((candidate) => candidate.id === plan);
    const list = doc.getIn(['plans', index, 'prices']);
    if (!isSeq(list)) continue;
    // The plan's price for this region and period is replaced; its others stay as they are.
    list.items = list.items.filter(
      (item) =>
        !(
          isMap(item) &&
          item.get('region') === price.region &&
          item.get('interval') === price.interval &&
          item.get('intervalCount') === price.intervalCount
        ),
    );
    list.add(doc.createNode(price));
  }
  // A provider that names each region's billing currency names the new one's too.
  const billing = doc.get('billingCurrency');
  if (isMap(billing) && !billing.has(where)) billing.set(where, prices[0].price.currency);
  await writeFile(
    absolute(file),
    await format(doc.toString({ lineWidth: 0 }), {
      ...(await resolveConfig(absolute(file))),
      filepath: absolute(file),
    }),
  );
  const { issues: catalog } = await checkCatalog();
  const mine = catalog.filter(({ issue }) => issue.file === file);
  for (const { issue, line } of mine)
    console.log(
      `${issue.severity === 'error' ? 'Error' : 'Warning'}: ${formatCatalogIssue(issue, line)}`,
    );
  for (const { plan, price } of prices) console.log(`Added: ${plan}: ${regionalPriceText(price)}`);
  const dropped = issues.filter((issue) => issue.kind === 'dropped').length;
  console.log(
    `Wrote ${file}: ${plural(prices.length, 'price')} for ${where}, ${dropped} dropped, ${plural(mine.filter(({ issue }) => issue.severity === 'error').length, 'validation error')}.`,
  );
  if (mine.some(({ issue }) => issue.severity === 'error')) process.exitCode = 1;
}

async function readRegionalAnswer(file: string, request: string): Promise<RegionalAnswer> {
  const json = await readJson<unknown>(file);
  if (json === undefined) fail(`No ${file}: answer ${request} there first (--prepare writes it).`);
  const parsed = regionalAnswerSchema.safeParse(json);
  if (!parsed.success) {
    fail(
      `${file} doesn't match the answer schema:\n${parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}

/** Workers AI's answer to a region's request (its REST API, from this machine). */
async function askWorkersAiRegional(regional: RegionalContext): Promise<RegionalAnswer> {
  loadDotEnv();
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const token = process.env['CLOUDFLARE_API_TOKEN'];
  if (!account || !token)
    fail('Workers AI needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${workersAiModel}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'Answer with the JSON the request asks for, and nothing else.',
          },
          { role: 'user', content: regionalPrompt(regional) },
        ],
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) fail(`Workers AI answered ${response.status}.`);
  const body = (await response.json()) as { result?: { response?: unknown } };
  const said = body.result?.response;
  let json: unknown = said;
  if (typeof said === 'string') {
    try {
      json = JSON.parse(said.slice(said.indexOf('{'), said.lastIndexOf('}') + 1));
    } catch {
      json = undefined;
    }
  }
  const parsed = regionalAnswerSchema.safeParse(json);
  if (!parsed.success) fail("Workers AI's answer didn't match the schema.");
  return parsed.data;
}

/** New shops at the end of data/resellers.yaml, keeping what's written above them. */
async function addResellers(shops: readonly Reseller[]): Promise<void> {
  if (shops.length === 0) return;
  const file = absolute('data/resellers.yaml');
  const document: Document = parseDocument(await readFile(file, 'utf8'));
  const list = document.contents;
  if (!isSeq(list)) fail('data/resellers.yaml must be a list');
  for (const shop of shops) list.items.push(document.createNode(shop));
  await writeFile(
    file,
    await format(document.toString({ lineWidth: 0 }), {
      ...(await resolveConfig(file)),
      filepath: file,
    }),
  );
  console.log(
    `Added ${shops.map((shop) => shop.id).join(', ')} to data/resellers.yaml: npm run data:icons fetches their logos.`,
  );
}

async function readAnswer(provider: string): Promise<ExtractionAnswer> {
  const file = workFile(provider, 'answer.json');
  const json = await readJson<unknown>(file);
  if (json === undefined)
    fail(
      `No ${file}: answer ${workFile(provider, 'extraction.md')} there first (--prepare writes it).`,
    );
  const parsed = extractionAnswerSchema.safeParse(json);
  if (!parsed.success) {
    fail(
      `${file} doesn't match the answer schema:\n${parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}

/** Workers AI's answers to each part of the request, merged (its REST API, from this machine). */
async function askWorkersAi(extraction: ExtractionContext): Promise<ExtractionAnswer> {
  loadDotEnv();
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const token = process.env['CLOUDFLARE_API_TOKEN'];
  if (!account || !token)
    fail('Workers AI needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.');
  const answers: ExtractionAnswer[] = [];
  for (const part of extractionParts(extraction)) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${workersAiModel}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: part.system },
            { role: 'user', content: part.user },
          ],
          max_tokens: 4096,
          // The schema is in the system message: JSON mode takes only part of JSON Schema, and the answer is checked.
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) fail(`Workers AI answered ${response.status} for the ${part.part}.`);
    const body = (await response.json()) as { result?: unknown };
    const answer = readModelAnswer(body.result);
    if (!answer) {
      console.log(`Workers AI's answer for the ${part.part} didn't match the schema: left out.`);
      continue;
    }
    answers.push(answer);
  }
  return mergeAnswers(answers);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
