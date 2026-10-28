import { Component, computed, inject, input, resource } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { severityText, suggestionSummary } from '@simply-sub/core';
import { OptimizerService } from '../../core/optimizer/optimizer-service';
import { DismissedSuggestionsRepository } from '../../core/storage/dismissed-suggestions-repository';

/**
 * List view's View optimizations (PROJECT-PLAN P4, M8.2): how many suggestions the list has that aren't dismissed,
 * coloured by the strongest (red, then orange, then yellow; green for free savings alone), or a neutral "No
 * suggestions". It links to the list's Optimizations page either way.
 */
@Component({
  selector: 'ss-optimizations-link',
  imports: [MatButton, RouterLink],
  templateUrl: './optimizations-link.html',
  styleUrl: './optimizations-link.scss',
})
export class OptimizationsLink {
  private readonly optimizer = inject(OptimizerService);
  private readonly dismissals = inject(DismissedSuggestionsRepository);

  readonly listId = input.required<string>();

  private readonly input = computed(() => this.optimizer.input(this.listId()));
  private readonly result = resource({
    params: () => this.input(),
    loader: ({ params }) => this.optimizer.run(params),
  });
  /** Undefined until the suggestions are found. */
  protected readonly summary = computed(() =>
    this.result.hasValue() && this.dismissals.status() === 'ready'
      ? suggestionSummary(this.result.value().suggestions, this.dismissals.fingerprints())
      : undefined,
  );
  /** With suggestions, its name says the strongest's section too, which its colour shows. */
  protected readonly label = computed(() => {
    const summary = this.summary();
    if (!summary?.strongest || summary.count === 0) return null;
    return `View optimizations (${summary.count}), the strongest: ${severityText[summary.strongest].heading}`;
  });
}
