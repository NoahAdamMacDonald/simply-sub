import { Injector, Service, inject } from '@angular/core';
import { reanchored, type IsoDate, type ListItem } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { ItemsRepository } from '../../core/storage/items-repository';

/**
 * "Wrong date?" (P4's cards, P10's day panel): asks for the date an item's next charge is really on, then saves it as
 * the item's new anchor straight to the item, like pinning, with no draft (PROJECT-PLAN §3.1). The dialog and the
 * datepicker load with the first question. Only an Ongoing item has an anchor to move.
 */
@Service()
export class WrongDate {
  private readonly injector = inject(Injector);
  private readonly items = inject(ItemsRepository);

  /** True once the new date is saved; false when the user cancelled. */
  async ask(item: ListItem, title: string, next: IsoDate): Promise<boolean> {
    const { billing } = item;
    if (billing.mode !== 'recurring') return false;
    const [{ MatDialog }, { WrongDateDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./wrong-date-dialog'),
    ]);
    const dialog = this.injector.get(MatDialog).open<unknown, unknown, IsoDate>(WrongDateDialog, {
      data: { title, billing, next },
      ariaDescribedBy: 'wrong-date-message',
      maxWidth: 'min(440px, calc(100vw - 32px))',
      width: '440px',
    });
    // Cancel, Escape and the backdrop close it with nothing ("" from mat-dialog-close).
    const date = await firstValueFrom(dialog.afterClosed());
    if (!date || date === next) return false;
    await this.items.update(item.id, { billing: reanchored(billing, date) });
    return true;
  }
}
