import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import type { IsoDate, ItemStatus } from '@simply-sub/core';
import { dateText, dayText } from '../date-text';

/** An item's status, or a provider that isn't in any list (Search only). */
export type BadgeStatus = ItemStatus | { kind: 'not-listed' };

const names = { active: 'Active', inactive: 'Inactive', 'not-listed': 'Not listed' } as const;

/**
 * Active, Inactive or Not listed, with a coloured dot (PROJECT-PLAN §3.3), and "active from Sep 10, 2026" for an
 * item that starts later. A small badge adds, for a manual renewal, "Renew by Nov 3", or for an active one that renews
 * by itself "Auto-renews Nov 3" (M6.12), and "Ends Nov 3" for one ending soon: one badge for both, "Renews Nov 3, then
 * ends Nov 28" (M6.19), and never a renewal on or after its end. Text after the status (Search's " · 2 lists") is
 * projected.
 */
@Component({
  selector: 'ss-status-badge',
  imports: [MatIcon],
  templateUrl: './status-badge.html',
  styleUrl: './status-badge.scss',
})
export class StatusBadge {
  readonly status = input.required<BadgeStatus>();
  /** The date of the item's next charge: when it renews, or for a manual renewal what it must be renewed by. */
  readonly nextCharge = input<IsoDate>();

  protected readonly text = computed(() => {
    const status = this.status();
    return status.kind === 'inactive' && status.activeFrom
      ? `${names.inactive} · active from ${dateText(status.activeFrom)}`
      : names[status.kind];
  });
  protected readonly endsOn = computed(() => {
    const status = this.status();
    return status.kind !== 'not-listed' && status.endsOn ? dayText(status.endsOn) : undefined;
  });
  /** The next charge, unless it's on or after the end (a charge an ending item doesn't make). */
  private readonly next = computed(() => {
    const status = this.status();
    const next = this.nextCharge();
    if (!next || status.kind === 'not-listed') return undefined;
    return status.endsOn !== undefined && next >= status.endsOn ? undefined : next;
  });
  /** "Renew by Nov 3" (with ↻), "Auto-renews Nov 3", "Ends Nov 28", or the renewal and the end together. */
  protected readonly badge = computed(() => {
    const status = this.status();
    if (status.kind === 'not-listed') return undefined;
    const next = this.next();
    const ends = this.endsOn();
    const then = ends ? `, then ends ${ends}` : '';
    if (status.manual && next) return { manual: true, text: `Renew by ${dayText(next)}${then}` };
    if (status.kind === 'active' && next) {
      return {
        manual: false,
        text: ends ? `Renews ${dayText(next)}${then}` : `Auto-renews ${dayText(next)}`,
      };
    }
    return ends ? { manual: false, text: `Ends ${ends}` } : undefined;
  });
}
