import { Component, inject } from '@angular/core';
import { ClockService } from '../../core/clock/clock-service';
import { CatalogPreview } from './catalog-preview/catalog-preview';

/** Placeholder: Home (PROJECT-PLAN P2) is built in M7.3. */
@Component({
  selector: 'ss-home-page',
  // TEMPORARY: CatalogPreview goes when Home is built (see catalog-preview/catalog-preview-data.ts).
  imports: [CatalogPreview],
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly today = inject(ClockService).today;
}
