import type { Price } from '@simply-sub/core';
import type { PriceOwner } from './types';

// Changes to the catalog's YAML files (BLUEPRINT §6.4), as the pull request makes them: a price's amount and
// lastVerified, a taxIncluded quote taken out, a reseller's listing removed. Each finds its lines by their indentation
// and keys and changes only those, so comments and layout stay as people wrote them; Prettier formats every file the
// same way (two spaces, a list's items under their key). CI's data:validate checks the result.

interface Block {
  start: number;
  end: number;
  indent: number;
}

/** Which price: its owner, and its region, currency and period. */
export interface PriceLocation {
  owner: PriceOwner;
  price: Pick<Price, 'region' | 'currency' | 'interval' | 'intervalCount'>;
}

/** `text` with the price's amount and lastVerified set, or undefined when the price isn't there. */
export function withPrice(
  text: string,
  at: PriceLocation,
  amount: number,
  lastVerified: string,
): string | undefined {
  return editPrice(
    text,
    at,
    (lines, item) =>
      setField(lines, item, 'amount', String(amount)) &&
      setField(lines, item, 'lastVerified', lastVerified),
  );
}

/** `text` with the price's lastVerified set. */
export function withLastVerified(
  text: string,
  at: PriceLocation,
  lastVerified: string,
): string | undefined {
  return editPrice(text, at, (lines, item) => setField(lines, item, 'lastVerified', lastVerified));
}

/** `text` without the price's taxIncluded, and with its lastVerified set. */
export function withoutTaxIncluded(
  text: string,
  at: PriceLocation,
  lastVerified: string,
): string | undefined {
  return editPrice(
    text,
    at,
    // lastVerified first: removing a line moves the item's end.
    (lines, item) =>
      setField(lines, item, 'lastVerified', lastVerified) &&
      removeField(lines, item, 'taxIncluded'),
  );
}

/** `text` without the provider's listing of `reseller` (and without `resellers` once it's the last). */
export function withoutReseller(text: string, reseller: string): string | undefined {
  const lines = text.split('\n');
  const resellers = keyBlock(lines, whole(lines), 0, 'resellers');
  if (!resellers) return undefined;
  const listings = items(lines, resellers, 2);
  const listing = listings.find((item) => fieldValue(lines, item, 'reseller') === reseller);
  if (!listing) return undefined;
  const removed = listings.length === 1 ? resellers : listing;
  lines.splice(removed.start, trimmedEnd(lines, removed) - removed.start);
  return lines.join('\n');
}

function editPrice(
  text: string,
  at: PriceLocation,
  change: (lines: string[], item: Block) => boolean,
): string | undefined {
  const lines = text.split('\n');
  const list = priceList(lines, at.owner);
  if (!list) return undefined;
  const matching = items(lines, list.block, list.indent).filter(
    (item) =>
      fieldValue(lines, item, 'region') === at.price.region &&
      fieldValue(lines, item, 'currency') === at.price.currency &&
      fieldValue(lines, item, 'interval') === at.price.interval &&
      fieldValue(lines, item, 'intervalCount') === String(at.price.intervalCount),
  );
  if (matching.length !== 1 || !change(lines, matching[0])) return undefined;
  return lines.join('\n');
}

/** The `prices` list an owner's prices are in, and its items' indent. */
function priceList(
  lines: string[],
  owner: PriceOwner,
): { block: Block; indent: number } | undefined {
  const top = whole(lines);
  const pricesOf = (item: Block) => {
    const block = keyBlock(lines, item, item.indent + 2, 'prices');
    return block && { block, indent: item.indent + 4 };
  };
  switch (owner.kind) {
    case 'bundle': {
      const block = keyBlock(lines, top, 0, 'prices');
      return block && { block, indent: 2 };
    }
    case 'plan':
    case 'addOn': {
      const list = keyBlock(lines, top, 0, owner.kind === 'plan' ? 'plans' : 'addOns');
      const item =
        list &&
        items(lines, list, 2).find((candidate) => fieldValue(lines, candidate, 'id') === owner.id);
      return item && pricesOf(item);
    }
    case 'reseller': {
      const list = keyBlock(lines, top, 0, 'resellers');
      const listing =
        list &&
        items(lines, list, 2).find(
          (candidate) => fieldValue(lines, candidate, 'reseller') === owner.reseller,
        );
      const offers = listing && keyBlock(lines, listing, 4, 'offers');
      const offer =
        offers &&
        items(lines, offers, 6).find(
          (candidate) => fieldValue(lines, candidate, 'plan') === owner.plan,
        );
      return offer && pricesOf(offer);
    }
  }
}

function whole(lines: string[]): Block {
  return { start: 0, end: lines.length, indent: -2 };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A line with something on it: not blank, not a comment. */
function isContent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

/** Where the block starting at `start` ends: the next content line indented `indent` or less. */
function blockEnd(lines: string[], start: number, indent: number, limit: number): number {
  for (let index = start + 1; index < limit; index++) {
    if (isContent(lines[index]) && indentOf(lines[index]) <= indent) return index;
  }
  return limit;
}

/** A block's end without the blank and comment lines that close it, which belong to what follows. */
function trimmedEnd(lines: string[], block: Block): number {
  let end = block.end;
  while (end > block.start + 1 && !isContent(lines[end - 1])) end--;
  return end;
}

/** The block of `key:` written at `indent` within `within`. */
function keyBlock(lines: string[], within: Block, indent: number, key: string): Block | undefined {
  for (let index = within.start; index < within.end; index++) {
    const line = lines[index];
    if (indentOf(line) === indent && line.trimStart().startsWith(`${key}:`)) {
      return { start: index, end: blockEnd(lines, index, indent, within.end), indent };
    }
  }
  return undefined;
}

/** The items of a list whose `- ` is at `indent` within `within`. */
function items(lines: string[], within: Block, indent: number): Block[] {
  const found: Block[] = [];
  for (let index = within.start; index < within.end; index++) {
    const line = lines[index];
    if (indentOf(line) === indent && line.trimStart().startsWith('- ')) {
      found.push({ start: index, end: blockEnd(lines, index, indent, within.end), indent });
    }
  }
  return found;
}

/** The line of an item's field: on the item's first line after `- `, or on its own at the item's indent + 2. */
function fieldLine(lines: string[], item: Block, name: string): number | undefined {
  for (let index = item.start; index < item.end; index++) {
    const line = lines[index];
    const own = index === item.start ? line.trimStart().slice(2) : line.trimStart();
    const at = index === item.start ? item.indent : indentOf(line);
    if (at === (index === item.start ? item.indent : item.indent + 2) && own.startsWith(`${name}:`))
      return index;
  }
  return undefined;
}

/** A field's scalar value, without its quotes. */
function fieldValue(lines: string[], item: Block, name: string): string | undefined {
  const index = fieldLine(lines, item, name);
  if (index === undefined) return undefined;
  const value = lines[index].slice(lines[index].indexOf(`${name}:`) + name.length + 1).trim();
  const unquoted = /^(['"])(.*)\1$/.exec(value);
  return unquoted ? unquoted[2] : value.replace(/\s+#.*$/, '');
}

function setField(lines: string[], item: Block, name: string, value: string): boolean {
  const index = fieldLine(lines, item, name);
  if (index === undefined) return false;
  const line = lines[index];
  const at = line.indexOf(`${name}:`);
  lines[index] = `${line.slice(0, at)}${name}: ${value}`;
  return true;
}

/** Removes a field and anything nested under it. */
function removeField(lines: string[], item: Block, name: string): boolean {
  const index = fieldLine(lines, item, name);
  if (index === undefined || index === item.start) return false;
  const end = blockEnd(lines, index, indentOf(lines[index]), item.end);
  lines.splice(index, end - index);
  return true;
}
