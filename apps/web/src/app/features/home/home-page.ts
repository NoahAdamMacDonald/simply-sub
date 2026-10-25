import { Component, inject } from '@angular/core';
import { ClockService } from '../../core/clock/clock-service';
import { ProgressPreview } from './progress-preview/progress-preview';

/** Placeholder: Home (PROJECT-PLAN P2) is built in M7.3. */
@Component({
  selector: 'ss-home-page',
  // TEMPORARY, preview branch only: see .claude/skills/progress-preview/SKILL.md.
  imports: [ProgressPreview],
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly today = inject(ClockService).today;
}
