import { DOCUMENT, Service, inject } from '@angular/core';
import { joinLinkUrl, type JoinLink } from '@simply-sub/core';
import { openJoinCode, sealJoinCode } from '../../core/crypto/join-crypto';
import { JoinCallError, postJoinCode, takeJoinCode, withdrawJoinCode } from './join-client';

/** A link made for the QR code: its address, its id, to withdraw it, and when it stops working. */
export interface MadeLink {
  url: string;
  id: string;
  expiresAt: string;
}

/** What taking a link found: the sync code, or why there's none. */
export type TakenLink =
  | { kind: 'code'; seed: Uint8Array<ArrayBuffer> }
  | { kind: 'gone' | 'offline' | 'unopenable' | 'failed' };

/**
 * Join links (PROJECT-PLAN M10.14, BLUEPRINT §11.4): the one-time QR codes that add a device to a sync chain. Show the
 * code makes one and withdraws it as it closes; Join takes one, scanned or opened in the browser (the /join route,
 * core/join-inbox.ts), which fetches the sealed code and so deletes it on the server.
 */
@Service()
export class JoinLinks {
  private readonly document = inject(DOCUMENT);

  /** A new link to the chain with this code, kept by the server for 10 minutes. Throws a JoinCallError. */
  async make(seed: Uint8Array<ArrayBuffer>): Promise<MadeLink> {
    const { key, sealed } = await sealJoinCode(seed);
    const { id, expiresAt } = await postJoinCode(sealed);
    return { url: joinLinkUrl(this.document.location.origin, { id, key }), id, expiresAt };
  }

  /** Withdraws a link no device has taken. */
  withdraw(id: string): Promise<void> {
    return withdrawJoinCode(id);
  }

  /** The sync code a link holds: the server answers it once, and deletes it. */
  async take(link: JoinLink): Promise<TakenLink> {
    let sealed: Uint8Array<ArrayBuffer>;
    try {
      sealed = await takeJoinCode(link.id);
    } catch (error) {
      if (!(error instanceof JoinCallError)) throw error;
      return {
        kind: error.problem === 'gone' || error.problem === 'offline' ? error.problem : 'failed',
      };
    }
    const seed = await openJoinCode(link.key, sealed);
    return seed ? { kind: 'code', seed } : { kind: 'unopenable' };
  }
}
