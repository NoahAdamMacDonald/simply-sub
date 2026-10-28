import { Injector, Service, inject } from '@angular/core';
import type { PaymentCard } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { wideDialogConfig } from '../../shared/wide-dialog';
import type { CardDialog, CardDialogData, CardDialogResult } from './card-dialog';

/**
 * Opens the card dialog (PROJECT-PLAN P11) from the Payment page. Material's dialog and the dialog itself load with
 * the first one, so they stay out of the page's chunk.
 */
@Service()
export class CardEditor {
  private readonly injector = inject(Injector);

  /** Edits `card`, or adds a new one; what was saved, or undefined when it was closed without saving. */
  async open(card?: PaymentCard): Promise<CardDialogResult | undefined> {
    const [{ MatDialog }, { CardDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./card-dialog'),
    ]);
    const dialog = this.injector
      .get(MatDialog)
      .open<CardDialog, CardDialogData, CardDialogResult>(CardDialog, {
        ...wideDialogConfig,
        data: { ...(card && { card }) },
      });
    return firstValueFrom(dialog.afterClosed());
  }
}
