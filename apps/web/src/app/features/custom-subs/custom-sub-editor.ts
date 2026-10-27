import { Injector, Service, inject } from '@angular/core';
import type { CustomSubscription } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { wideDialogConfig } from '../../shared/wide-dialog';
import type {
  CustomSubDialog,
  CustomSubDialogData,
  CustomSubDialogResult,
} from './custom-sub-dialog';

/**
 * Opens the custom subscription editor (P12), from its page and from the list editor's "Create new…" (flow F3).
 * Material's dialog and the editor load with the first one, so they stay out of either page's chunk.
 */
@Service()
export class CustomSubEditor {
  private readonly injector = inject(Injector);

  /** Edits `sub`, or makes a new one; what was saved, or undefined when it was closed without saving. */
  async open(sub?: CustomSubscription): Promise<CustomSubDialogResult | undefined> {
    const [{ MatDialog }, { CustomSubDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./custom-sub-dialog'),
    ]);
    const dialog = this.injector
      .get(MatDialog)
      .open<CustomSubDialog, CustomSubDialogData, CustomSubDialogResult>(CustomSubDialog, {
        ...wideDialogConfig,
        data: { ...(sub && { sub }) },
      });
    return firstValueFrom(dialog.afterClosed());
  }
}
