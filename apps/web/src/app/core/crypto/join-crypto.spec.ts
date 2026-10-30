import { openJoinCode, sealJoinCode } from './join-crypto';
import { fromBase64 } from './passphrase-crypto';

// A join link's seal (M10.14): the contract's example opens with its link's key (the code 0x00..0x1f, sealed with the
// key 0x40..0x5f), a sealed code opens with its own key only, and a changed byte opens nothing.

const counting = Uint8Array.from({ length: 32 }, (_, index) => index);
const exampleKey = 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8';
const exampleSealed = fromBase64(
  'AaChoqOkpaanqKmqq9eOBDzm7poqcWZL9YWxPvn/BufU+HqTOvrF9IH132Dn+8HGQ/R+tiAS23AcFJXkNA==',
);

describe('a join link’s seal', () => {
  it('opens the contract’s example with its link’s key', async () => {
    expect(await openJoinCode(exampleKey, exampleSealed)).toEqual(counting);
  });

  it('seals a code with a new 32-byte key each time, which opens it', async () => {
    const first = await sealJoinCode(counting);
    const second = await sealJoinCode(counting);

    expect(first.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.key).not.toBe(second.key);
    expect(first.sealed).toHaveLength(61);
    expect(await openJoinCode(first.key, first.sealed)).toEqual(counting);
  });

  it('opens nothing with another key, a changed byte, or bytes that aren’t a sealed code', async () => {
    const { key, sealed } = await sealJoinCode(counting);
    const changed = sealed.slice();
    changed[20] ^= 1;

    expect(await openJoinCode((await sealJoinCode(counting)).key, sealed)).toBeUndefined();
    expect(await openJoinCode(key, changed)).toBeUndefined();
    expect(await openJoinCode(key, new Uint8Array(8))).toBeUndefined();
    expect(await openJoinCode('not a key', sealed)).toBeUndefined();
  });
});
