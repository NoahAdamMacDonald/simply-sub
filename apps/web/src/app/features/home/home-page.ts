import { Component, inject } from '@angular/core';
import { ClockService } from '../../core/clock/clock-service';
import { ProgressPreview } from './progress-preview/progress-preview';

/** Placeholder: Home (PROJECT-PLAN P2) is built in M7.3. */
@Component({
  selector: 'ss-home-page',
  // TEMPORARY: ProgressPreview goes before M4 starts (see progress-preview/progress-preview.ts).
  imports: [ProgressPreview],
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly today = inject(ClockService).today;
}
