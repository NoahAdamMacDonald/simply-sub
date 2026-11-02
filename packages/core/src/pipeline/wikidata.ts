import * as z from 'zod';
import { idFromName, type QueueCandidate } from './queue';
import { httpsAddress, parseWebAddress } from './web-address';

// Services from Wikidata (BLUEPRINT §6.5, M3.1): free, CC0-licensed, with each service's official website (P856).
// scripts/discover-services.ts asks the query service once per class below and adds what it finds to data/queue.yaml.

/** A Wikidata class whose instances are services of one of our service categories. */
export interface WikidataClass {
  /** Its item id. */
  qid: string;
  /** Its English label, for the script's output. */
  name: string;
  /** The service category (categories.yaml) its instances get. */
  category: string;
  /** The most of its instances to ask for, when fewer than the script's limit. */
  limit?: number;
}

/**
 * The classes asked for, in order: a service that's an instance of several gets the first one's category, so the
 * narrower classes come first (GitHub is a social networking service too, and Indeed a search engine). Read on
 * 2026-10-28 from what Netflix, Spotify, Mullvad, 1Password, Dropbox, Claude, Xbox Game Pass, Coursera and others
 * are instances of, and on 2026-11-02 (M11.3) from what Firefox, DuckDuckGo, Proton Mail, Quad9, Google Maps,
 * GitHub, AWS, Figma, Uber Eats, Indeed, Rogers, N26 and others are, each class checked for the services it finds
 * with 8 Wikipedia articles or more. Plain "subscription" (Q322948) is left out: it says nothing about the category.
 * Wikidata files WeTransfer and Smash as file hosting, so file sharing and calendars fill mostly by hand.
 */
export const wikidataClasses: readonly WikidataClass[] = [
  { qid: 'Q59152282', name: 'video streaming service', category: 'streaming' },
  { qid: 'Q16294865', name: 'subscription video on demand service', category: 'streaming' },
  { qid: 'Q829548', name: 'over-the-top media service', category: 'streaming' },
  { qid: 'Q15590336', name: 'music streaming service', category: 'music' },
  { qid: 'Q56240391', name: 'virtual private network service', category: 'vpn' },
  { qid: 'Q1281199', name: 'password manager', category: 'passwords' },
  { qid: 'Q4825890', name: 'authenticator', category: 'passwords' },
  { qid: 'Q93249', name: 'antivirus software', category: 'security' },
  { qid: 'Q5368818', name: 'email hosting service', category: 'email' },
  { qid: 'Q1273203', name: 'mailbox provider', category: 'email' },
  { qid: 'Q2933820', name: 'digital calendar', category: 'calendar' },
  { qid: 'Q2373485', name: 'peer-to-peer file sharing', category: 'file-sharing' },
  { qid: 'Q1343205', name: 'file-hosting service', category: 'storage' },
  { qid: 'Q133284163', name: 'generative artificial intelligence chatbot', category: 'ai' },
  { qid: 'Q19967846', name: 'online gaming service', category: 'gaming' },
  { qid: 'Q85632250', name: 'cloud gaming service', category: 'gaming' },
  { qid: 'Q115203600', name: 'repository hosting service', category: 'developer' },
  { qid: 'Q3077240', name: 'forge', category: 'developer' },
  { qid: 'Q13741', name: 'integrated development environment', category: 'developer', limit: 15 },
  { qid: 'Q1210425', name: 'internet hosting service', category: 'cloud' },
  { qid: 'Q1153767', name: 'platform as a service', category: 'cloud' },
  { qid: 'Q5892272', name: 'web hosting service', category: 'cloud' },
  { qid: 'Q124843345', name: 'web hosting service', category: 'cloud' },
  // Most are desktop software sold once or free: the best-known few.
  { qid: 'Q868410', name: 'graphics software', category: 'creative', limit: 15 },
  { qid: 'Q2351962', name: 'raster graphics editor', category: 'creative', limit: 15 },
  { qid: 'Q1155404', name: 'vector graphics editor', category: 'creative', limit: 15 },
  { qid: 'Q1373429', name: 'video editing software', category: 'creative', limit: 15 },
  { qid: 'Q1060750', name: 'digital audio workstation', category: 'creative', limit: 15 },
  { qid: 'Q6368', name: 'web browser', category: 'browsers' },
  { qid: 'Q4182287', name: 'search engine', category: 'search' },
  { qid: 'Q127386655', name: 'DNS provider', category: 'dns' },
  { qid: 'Q41494', name: 'name server', category: 'dns' },
  { qid: 'Q124587498', name: 'internet map service', category: 'maps' },
  { qid: 'Q128800992', name: 'web mapping application', category: 'maps' },
  { qid: 'Q580148', name: 'employment website', category: 'jobs' },
  { qid: 'Q5283178', name: 'distributed social network', category: 'social' },
  { qid: 'Q3220391', name: 'social networking service', category: 'social' },
  { qid: 'Q19862851', name: 'massive open online course provider', category: 'education' },
  { qid: 'Q31725945', name: 'online learning platform', category: 'education' },
  { qid: 'Q25104632', name: 'fitness app', category: 'fitness' },
  // Hundreds have a website; the best-known few are the subscriptions people pay for.
  { qid: 'Q1110794', name: 'daily newspaper', category: 'news', limit: 15 },
  { qid: 'Q1426546', name: 'loyalty program', category: 'shopping' },
  { qid: 'Q24962921', name: 'subscription box', category: 'shopping' },
  { qid: 'Q10932402', name: 'food delivery', category: 'delivery' },
  { qid: 'Q3181044', name: 'online food ordering', category: 'delivery' },
  { qid: 'Q27973', name: 'ridesharing company', category: 'delivery' },
  { qid: 'Q65295049', name: 'online taxi service', category: 'delivery' },
  // Telecom waits for a design of its own (PROJECT-PLAN M11), and finance for M11.10: the best-known few.
  { qid: 'Q1941618', name: 'mobile network operator', category: 'telecom', limit: 15 },
  { qid: 'Q11371', name: 'internet service provider', category: 'telecom', limit: 15 },
  { qid: 'Q60767305', name: 'neobank', category: 'finance' },
  { qid: 'Q1227557', name: 'direct bank', category: 'finance' },
  { qid: 'Q745877', name: 'credit union', category: 'finance', limit: 15 },
  { qid: 'Q2073644', name: 'brokerage firm', category: 'finance', limit: 15 },
  { qid: 'Q21096079', name: 'robo-advisor', category: 'finance' },
  { qid: 'Q22687', name: 'bank', category: 'finance', limit: 15 },
];

/** The query service's address. */
export const wikidataEndpoint = 'https://query.wikidata.org/sparql';

/**
 * The SPARQL query for one class's instances that have an official website, an English name and at least
 * `minSitelinks` Wikipedia articles, the most written-about first, without those that closed (dissolved P576,
 * discontinued P2669, retired P730). Below about 8 articles the classes fill with tiny apps, casinos and courses.
 */
export function wikidataQuery(qid: string, limit: number, minSitelinks: number): string {
  if (!/^Q[1-9]\d*$/.test(qid)) throw new Error(`Not a Wikidata item id: ${qid}`);
  return `SELECT ?item ?name ?sitelinks (GROUP_CONCAT(DISTINCT STR(?website); separator=" ") AS ?websites) WHERE {
  ?item wdt:P31 wd:${qid} ;
        wdt:P856 ?website ;
        wikibase:sitelinks ?sitelinks ;
        rdfs:label ?name .
  FILTER(LANG(?name) = "en")
  FILTER(?sitelinks >= ${Math.max(0, Math.floor(minSitelinks))})
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  FILTER NOT EXISTS { ?item wdt:P2669 [] }
  FILTER NOT EXISTS { ?item wdt:P730 [] }
}
GROUP BY ?item ?name ?sitelinks
ORDER BY DESC(?sitelinks) ?item
LIMIT ${Math.max(1, Math.floor(limit))}`;
}

const bindingSchema = z.object({ value: z.string() });
const resultsSchema = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        item: bindingSchema,
        name: bindingSchema,
        sitelinks: bindingSchema,
        websites: bindingSchema,
      }),
    ),
  }),
});

/**
 * The services in a query's JSON answer, as queue candidates in the answer's order: each with an id from its name and
 * the website `pickWebsite` chooses. Rows without a usable website or name are left out.
 */
export function readWikidataResults(json: unknown, category: string): QueueCandidate[] {
  const parsed = resultsSchema.safeParse(json);
  if (!parsed.success) throw new Error('The query service’s answer isn’t SPARQL JSON results');
  const candidates: QueueCandidate[] = [];
  for (const row of parsed.data.results.bindings) {
    const qid = /\/entity\/(Q\d+)$/.exec(row.item.value)?.[1];
    const name = row.name.value.trim();
    const id = idFromName(name);
    const website = pickWebsite(row.websites.value.split(' '), name);
    if (!qid || !id || !website) continue;
    const sitelinks = Number(row.sitelinks.value);
    candidates.push({
      id,
      name,
      website,
      category,
      wikidata: qid,
      ...(Number.isInteger(sitelinks) && sitelinks >= 0 && { sitelinks }),
    });
  }
  return candidates;
}

/**
 * The website to start from among an item's official ones: a web address (no onion service), as https; one whose host
 * has a word of the name in it (YouTube Premium also lists an unrelated APK site, and Amazon Prime Video is on
 * primevideo.com); then the fewest path segments (the home page over a country's), the shortest, and the first
 * alphabetically, so the choice is stable.
 */
export function pickWebsite(websites: readonly string[], name: string): string | undefined {
  const words = idFromName(name)
    .split('-')
    .filter((word) => word.length >= 3 && word !== 'the' && word !== 'and');
  const usable = websites.flatMap((raw) => {
    const address = parseWebAddress(raw);
    if (!address || address.host.endsWith('.onion')) return [];
    const href = httpsAddress({ ...address, query: '' }).replace(/\/$/, '');
    const segments = address.path.split('/').filter(Boolean).length;
    const host = address.host.replace(/[^a-z0-9]/g, '');
    const named = words.some((word) => host.includes(word)) ? 0 : 1;
    return [{ href, rank: [named, segments, href.length] as const }];
  });
  usable.sort(
    (a, b) =>
      a.rank[0] - b.rank[0] ||
      a.rank[1] - b.rank[1] ||
      a.rank[2] - b.rank[2] ||
      (a.href < b.href ? -1 : a.href > b.href ? 1 : 0),
  );
  return usable[0]?.href;
}

/**
 * Every class's candidates in one list, each item once: the first class that has it gives its category, and the
 * order is the most written-about first across all classes.
 */
export function combineCandidates(
  perClass: readonly (readonly QueueCandidate[])[],
): QueueCandidate[] {
  const seen = new Set<string>();
  const all: QueueCandidate[] = [];
  for (const candidates of perClass) {
    for (const candidate of candidates) {
      const key = candidate.wikidata ?? candidate.id;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(candidate);
    }
  }
  // A stable sort: equal counts keep the classes' order.
  return all.sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0));
}
