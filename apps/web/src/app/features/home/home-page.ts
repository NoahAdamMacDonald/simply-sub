import { Component, inject } from '@angular/core';
import { ClockService } from '../../core/clock/clock-service';

/** Placeholder: Home (PROJECT-PLAN P2) is built in M7.3. */
@Component({
  selector: 'ss-home-page',
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly today = inject(ClockService).today;
}
