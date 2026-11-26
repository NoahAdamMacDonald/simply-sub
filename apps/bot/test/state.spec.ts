import { describe, expect, it } from 'vitest';
import { memoryState, type Pending } from '../src/state';
import { Writes } from '../src/writes';

// The bot's state in KV (state.ts). The free plan gives the account 1,000 KV writes and 1,000 deletes a day, and the
// night of 2026-11-24 spent the writes rewriting pending entries that hadn't changed: an entry is written only when
// what it proposes changes, and deleted only when it's there.

const entry: Pending = {
  key: 'https://www.netflix.com/signup/planform',
  seen: '2026-11-23',
  owner: 'netflix',
  findings: [{ kind: 'manual', subject: 'netflix', reason: 'The Standard plan’s price changed.' }],
};

describe('pending entries', () => {
  it('writes an entry once, and not again for a night that finds the same', async () => {
    const writes = new Writes();
    const state = memoryState(writes);
    await state.putPending(entry);
    await state.putPending({ ...entry, seen: '2026-11-24' });
    expect(writes.used).toBe(1);
    expect(await state.pending()).toEqual([entry]);
  });

  it('writes it again when its findings or its provider change', async () => {
    const writes = new Writes();
    const state = memoryState(writes);
    await state.putPending(entry);
    const changed: Pending = {
      ...entry,
      seen: '2026-11-24',
      findings: [
        { kind: 'manual', subject: 'netflix', reason: 'The Premium plan’s price changed.' },
      ],
    };
    await state.putPending(changed);
    await state.putPending({ ...changed, owner: 'netflix-basic' });
    expect(writes.used).toBe(3);
    expect(await state.pending()).toEqual([{ ...changed, owner: 'netflix-basic' }]);
  });

  it('deletes only an entry that is there', async () => {
    const writes = new Writes();
    const state = memoryState(writes);
    await state.dropPending(entry.key);
    expect(writes.used).toBe(0);
    await state.putPending(entry);
    await state.dropPending(entry.key);
    expect(writes.used).toBe(2);
    expect(await state.pending()).toEqual([]);
  });
});

describe('reading in bulk (2026-11-25)', () => {
  it('reads pending entries a hundred a request', async () => {
    const writes = new Writes();
    const state = memoryState(writes);
    for (let n = 0; n < 250; n++)
      await state.putPending({ ...entry, key: `https://example.com/${n}` });
    writes.calls = 0;
    const found = await state.pendingAt(await state.pendingNames());
    expect(found).toHaveLength(250);
    // One list, and three bulk reads.
    expect(writes.calls).toBe(4);
  });

  it('reads the earlier parts’ step results at once, not one a step', async () => {
    const writes = new Writes();
    const state = memoryState(writes);
    const first = state.night('2026-11-25', false);
    for (let n = 0; n < 150; n++) await first.put(`check provider-${n}`, n);
    writes.calls = 0;
    const second = state.night('2026-11-25', true);
    for (let n = 0; n < 150; n++) {
      expect(await second.get(`check provider-${n}`)).toEqual({ value: n });
    }
    expect(writes.calls).toBe(3);
    // A step no part has finished is read on its own.
    expect(await second.get('build the digest')).toBeUndefined();
    expect(writes.calls).toBe(4);
  });
});
