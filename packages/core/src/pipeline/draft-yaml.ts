// A drafted provider file as YAML (BLUEPRINT §6.5 ⑥, M3.4), written the way the catalog's files are, so Prettier (and
// CI's format check) leaves it as it is, and the bot can write one without Prettier: two-space indents, a list's items
// under their key, short lists of words and short maps of words on one line (aliases: [mullvad],
// billingCurrency: { CA: CAD }), single quotes where a string needs quotes, comments on their own lines.

/** A comment above a key, by the key's path: [] for the file's header, ['plans'] above the plans. */
export interface YamlComments {
  header?: readonly string[];
  /** Key path (joined with '.') → its comment lines. */
  above?: Readonly<Record<string, readonly string[]>>;
}

/** The widest line Prettier leaves alone (.prettierrc's printWidth). */
const printWidth = 100;

/** The YAML for `value`, a provider file's object, with its comments. */
export function draftYaml(value: Record<string, unknown>, comments: YamlComments = {}): string {
  const lines: string[] = [];
  for (const line of comments.header ?? []) lines.push(comment(line, 0));
  if (comments.header && comments.header.length > 0) lines.push('');
  writeMap(value, 0, [], lines, comments.above ?? {}, true);
  return `${lines.join('\n')}\n`;
}

/** A comment's lines, wrapped at word breaks the way the repository's comments are (118 characters). */
function comment(line: string, indent: number): string {
  const pad = `${' '.repeat(indent)}#`;
  if (line === '') return pad;
  const lines: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current !== '' && pad.length + 1 + current.length + 1 + word.length > commentWidth) {
      lines.push(`${pad} ${current}`);
      current = word;
    } else {
      current = current === '' ? word : `${current} ${word}`;
    }
  }
  lines.push(`${pad} ${current}`);
  return lines.join('\n');
}

const commentWidth = 118;

function writeMap(
  map: Record<string, unknown>,
  indent: number,
  path: readonly string[],
  lines: string[],
  above: Readonly<Record<string, readonly string[]>>,
  topLevel = false,
): void {
  const pad = ' '.repeat(indent);
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue;
    const keyPath = [...path, key];
    const notes = above[keyPath.join('.')];
    // A blank line before the top level's lists of plans, add-ons, resellers and policies, as the files have.
    if (
      topLevel &&
      isObject(value) === false &&
      Array.isArray(value) &&
      value.some(isObject) &&
      lines.length > 0
    ) {
      lines.push('');
    } else if (topLevel && key === 'policies' && lines.length > 0) {
      lines.push('');
    }
    for (const line of notes ?? []) lines.push(comment(line, indent));
    const name = `${pad}${yamlKey(key)}:`;
    const inline = inlineValue(value);
    if (inline !== undefined && name.length + 1 + inline.length <= printWidth) {
      lines.push(`${name} ${inline}`);
    } else if (Array.isArray(value)) {
      lines.push(name);
      writeList(value, indent + 2, keyPath, lines, above);
    } else if (isObject(value)) {
      lines.push(name);
      writeMap(value, indent + 2, keyPath, lines, above);
    } else {
      lines.push(`${name} ${scalar(value)}`);
    }
  }
}

function writeList(
  list: readonly unknown[],
  indent: number,
  path: readonly string[],
  lines: string[],
  above: Readonly<Record<string, readonly string[]>>,
): void {
  const pad = ' '.repeat(indent);
  list.forEach((item, index) => {
    // Plans and the like read better a blank line apart.
    if (index > 0 && isObject(item) && path.length === 1 && ['plans', 'addOns'].includes(path[0]))
      lines.push('');
    if (isObject(item)) {
      const inner: string[] = [];
      writeMap(item, indent + 2, [...path, String(index)], inner, above);
      // The first key goes after the dash.
      const first = inner.findIndex((line) => !line.trimStart().startsWith('#'));
      inner.forEach((line, at) => {
        lines.push(at === first ? `${pad}- ${line.slice(indent + 2)}` : line);
      });
    } else {
      const inline = inlineValue(item);
      lines.push(`${pad}- ${inline ?? scalar(item)}`);
    }
  });
}

/** A value written on its key's line: a scalar, or a short list or map of scalars. Undefined for anything else. */
function inlineValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (!value.every(isScalar)) return undefined;
    // Sentences read better one to a line: only short items go on one line.
    if (value.some((item) => typeof item === 'string' && (item.length > 40 || /[.:]\s/.test(item))))
      return undefined;
    return `[${value.map((item) => flowScalar(item)).join(', ')}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return '{}';
    if (entries.length > 3 || !entries.every(([, item]) => isScalar(item))) return undefined;
    return `{ ${entries.map(([key, item]) => `${yamlKey(key)}: ${flowScalar(item)}`).join(', ')} }`;
  }
  return isScalar(value) ? scalar(value) : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function yamlKey(key: string): string {
  return /^[A-Za-z0-9][\w.+-]*$/.test(key) && !reserved.test(key) ? key : quoted(key);
}

/** Plain words YAML would read as something else: true, null, a number. */
const reserved =
  /^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|0x[0-9a-f]+|0o[0-7]+|[-+]?\.(?:inf|nan))$/i;

/** A scalar as a block value. */
function scalar(value: unknown): string {
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : quoted(String(value));
  if (typeof value === 'boolean') return String(value);
  const text = String(value);
  return plainSafe(text, false) ? text : quoted(text);
}

/** A scalar inside [ ] or { }, where commas and brackets need quotes too. */
function flowScalar(value: unknown): string {
  if (typeof value !== 'string') return scalar(value);
  return plainSafe(value, true) ? value : quoted(value);
}

function plainSafe(text: string, inFlow: boolean): boolean {
  if (text === '' || text !== text.trim() || reserved.test(text)) return false;
  if (/[\n\r\t\\]/.test(text)) return false;
  // An indicator first, ": " or " #" inside, or a colon last make it something else.
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) && !/^-\d/.test(text)) return false;
  if (/: |\s#|:$/.test(text)) return false;
  if (inFlow && /[,[\]{}]/.test(text)) return false;
  return true;
}

/** Single quotes, as Prettier writes them (singleQuote), unless the text has a ' and no ", or needs escapes. */
function quoted(text: string): string {
  // A line break or another control character needs a double-quoted escape; a backslash is plain in single quotes.
  if (text.split('').some((character) => character.charCodeAt(0) < 0x20))
    return JSON.stringify(text);
  if (text.includes("'") && !text.includes('"')) return `"${text}"`;
  return `'${text.replace(/'/g, "''")}'`;
}
