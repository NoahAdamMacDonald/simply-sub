import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import type { IsoDate, ItemStatus } from '@simply-sub/core';
import { dateText, dayText } from '../date-text';

/** An item's status, or a provider that isn't in any list (Search only). */
export type BadgeStatus = ItemStatus | { kind: 'not-listed' };

const names = { active: 'Active', inactive: 'Inactive', 'not-listed': 'Not listed' } as const;

/**
 * Active, Inactive or Not listed, with a coloured dot (PROJECT-PLAN §3.3), and "active from Sep 10, 2026" for an
 * item that starts later. Small badges add "Ends Nov 3" and, for a manual renewal, "Renew by Nov 3", or for an active
 * one that renews by itself "Auto-renews Nov 3" (M6.12). Text after the status (Search's " · 2 lists") is projected.
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
  protected readonly renewBy = computed(() => {
    const status = this.status();
    const next = this.nextCharge();
    return status.kind !== 'not-listed' && status.manual && next ? dayText(next) : undefined;
  });
  protected readonly renews = computed(() => {
    const status = this.status();
    const next = this.nextCharge();
    return status.kind === 'active' && !status.manual && next ? dayText(next) : undefined;
  });
}
