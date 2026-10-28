// robots.txt (RFC 9309), which the bot follows for every page it reads (BLUEPRINT §6.4). The group for its own token,
// else `*`; within it, the longest matching rule decides, and Allow wins a tie. `*` matches anything and `$` ends a
// pattern. A site's rules are read once a night and passed from step to step, so they're kept small: only the
// group that applies.

/** The token the bot's User-Agent starts with, which a site's robots.txt can name. */
export const robotsToken = 'SimplySubBot';

/** The User-Agent of every request the bot makes. */
export const userAgent = `${robotsToken}/1.0 (+https://sub.simplely.ca/)`;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/**
 * What a site's robots.txt says the bot may read: its rules, everything (none, or a 4xx: RFC 9309 §2.3.1.3), or
 * nothing (it couldn't be read: a 5xx or no answer, §2.3.1.4).
 */
export type Robots = { rules: RobotsRule[] } | 'allow-all' | 'disallow-all';

/** The rules of a robots.txt that apply to the bot: its own token's group, else `*`'s. */
export function parseRobots(text: string): Robots {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && current && value !== '') {
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  const token = robotsToken.toLowerCase();
  const own = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && token.startsWith(agent)),
  );
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'));
  return { rules: chosen.flatMap((group) => group.rules) };
}

/** Whether `robots` lets the bot read `path` (with its query). */
export function robotsAllow(robots: Robots, path: string): boolean {
  if (robots === 'allow-all') return true;
  if (robots === 'disallow-all') return false;
  let best: RobotsRule | undefined;
  for (const rule of robots.rules) {
    if (!matches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}
