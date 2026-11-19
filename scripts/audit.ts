// The dependency audit CI runs (BLUEPRINT §11.5): `npm audit` for high and critical advisories in every dependency, dev
// tools included, since they build what ships. A fixed advisory is pinned in package.json's `overrides` (CLAUDE.md). One
// with no fixed version anywhere can be listed in scripts/audit-allowlist.json with why it's safe to wait and a date to
// look again by; the audit then passes it until that date. An entry past its date fails, so the list never outlives
// its reason; one no advisory needs today is only a warning, since npm's advisory data can differ between machines.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface Allowed {
  id: string;
  package: string;
  reason: string;
  reviewBy: string;
}

interface Via {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
}

interface Report {
  vulnerabilities?: Record<string, { severity: string; via: (string | Via)[] }>;
}

const failing = new Set(['high', 'critical']);
const allowlist = JSON.parse(
  readFileSync(new URL('audit-allowlist.json', import.meta.url), 'utf8'),
) as Allowed[];

// npm audit exits 1 when it finds anything, so its output is read either way.
let output: string;
try {
  output = execSync('npm audit --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  output = (error as { stdout?: string }).stdout ?? '';
}
const report = JSON.parse(output) as Report;

// Each advisory once, by its GitHub id, with the package it's in.
const advisories = new Map<string, { package: string; title: string; severity: string }>();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via === 'string' || via.url === undefined || via.severity === undefined) continue;
    const id = via.url.split('/').at(-1) ?? via.url;
    advisories.set(id, {
      package: via.name ?? '?',
      title: via.title ?? '',
      severity: via.severity,
    });
  }
}

const today = new Date().toISOString().slice(0, 10);
const problems: string[] = [];
for (const [id, advisory] of advisories) {
  if (!failing.has(advisory.severity)) continue;
  const allowed = allowlist.find((entry) => entry.id === id);
  if (allowed === undefined) {
    problems.push(
      `${advisory.severity} ${id} in ${advisory.package}: ${advisory.title} (pin a fixed version in overrides)`,
    );
  } else if (allowed.reviewBy < today) {
    problems.push(
      `${id} in ${advisory.package} was allowed until ${allowed.reviewBy}: look for a fix again, then pin it or move the date`,
    );
  } else {
    console.log(
      `Allowed until ${allowed.reviewBy}: ${id} in ${advisory.package} (${allowed.reason})`,
    );
  }
}
for (const entry of allowlist) {
  if (!advisories.has(entry.id)) {
    console.warn(
      `${entry.id} in ${entry.package} isn't reported here: remove it from scripts/audit-allowlist.json once it's fixed`,
    );
  }
}

for (const problem of problems) console.error(problem);
console.log(
  `Checked ${advisories.size} advisories: ${problems.length > 0 ? `${problems.length} to fix` : 'none high or critical outside the allowlist'}.`,
);
process.exitCode = problems.length > 0 ? 1 : 0;
