import { signal } from '@angular/core';

/**
 * A join link opened in the browser (PROJECT-PLAN M10.14): the /join route keeps what came after its #, in memory, and
 * goes on to Settings without it, so the link leaves the address bar at once, even with the app locked. Join takes it
 * from here: Settings' sync card once the app is unlocked, or the first run's dialog on a new device.
 */
export const joinInbox = signal<string | undefined>(undefined);
