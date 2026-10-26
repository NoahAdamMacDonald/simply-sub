import { Component, input } from '@angular/core';
import type { FeatureSummaryRow } from '@simply-sub/core';

/**
 * A feature summary, "VPN: 2 / 3" (PROJECT-PLAN §3.2): for each key, the active items that provide it out of all the
 * items that do. Core's featureSummary (M6.1) chooses and orders the rows.
 */
@Component({
  selector: 'ss-feature-summary',
  templateUrl: './feature-summary.html',
  styleUrl: './feature-summary.scss',
})
export class FeatureSummary {
  readonly rows = input.required<readonly FeatureSummaryRow[]>();
}
