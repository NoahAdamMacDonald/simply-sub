import type { CanDeactivateFn } from '@angular/router';

/** A page that may ask before it's left: the list editor's "Discard changes?" (P5). */
export interface AsksBeforeLeaving {
  /** Whether to go on to `url`, after asking the user if need be. */
  canLeave(url: string): boolean | Promise<boolean>;
}

/**
 * The canDeactivate of a page that asks before it's left. It knows the page only by its type, so the page's code stays
 * in its lazy chunk.
 */
export const leaveGuard: CanDeactivateFn<AsksBeforeLeaving> = (page, _route, _state, next) =>
  page.canLeave(next.url);
