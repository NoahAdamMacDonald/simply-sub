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
  queueFileSchema,
  readModelAnswer,
  workersAiModel,
  type ExtractionAnswer,
  type ExtractionContext,
  type ExtractionPage,
  type PageKind,
} from '@simply-sub/core';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { parse } from 'yaml';
import { checkCatalog, loadCatalogFiles, plural } from './lib/catalog-files';
import {
  absolute,
  readJson,
  workFile,
  writeJson,
  type FoundUrls,
  type PageRecord,
} from './lib/pipeline-files';
import { loadDotEnv } from './lib/search';

const args = process.argv.slice(2);
const [id] = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--model');
if (!id) fail('Name the provider: npm run data:extract -- <id> [--prepare | --model workers-ai]');
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined;
if (model !== undefined && model !== 'workers-ai') fail('--model takes workers-ai');

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
  const pages: ExtractionPage[] = [];
  const folder = absolute(workFile(provider, 'pages'));
  const names = (await readdir(folder).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.json'))
    .sort();
  for (const name of names) {
    const record = JSON.parse(await readFile(`${folder}/${name}`, 'utf8')) as
      PageRecord | { error: string };
    if ('error' in record) continue;
    if (!(pageKinds as readonly string[]).includes(record.kind)) continue;
    pages.push({
      name: name.slice(0, -'.json'.length),
      kind: record.kind as PageKind,
      url: record.finalUrl,
      text: [
        record.renderedText,
        ...record.views.map((view) => `--- after clicking "${view.label}" ---\n${view.text}`),
      ].join('\n\n'),
    });
  }
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
    today: new Date().toISOString().slice(0, 10),
  };
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
