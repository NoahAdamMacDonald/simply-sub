import { Injector, Service, inject } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** The confirm button's text: what it does ("Delete list"). */
  confirmText: string;
  /** A destructive action: the button takes the danger colour, and focus starts on Cancel. */
  danger?: boolean;
}

let nextId = 0;

/**
 * Asks the user to confirm an action in a dialog (PROJECT-PLAN §4.3), and resolves to true only when they do: Cancel,
 * Escape and a click outside resolve to false. Material's dialog loads with the first question, as the first-run
 * dialog's does, so it stays out of the initial bundle wherever this service is used.
 */
@Service()
export class ConfirmService {
  private readonly injector = inject(Injector);

  async confirm(options: ConfirmOptions): Promise<boolean> {
    const [{ MatDialog }, { ConfirmDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./confirm-dialog'),
    ]);
    const messageId = `ss-confirm-${nextId++}-message`;
    const dialog = this.injector.get(MatDialog).open(ConfirmDialog, {
      data: { ...options, messageId },
      role: 'alertdialog',
      ariaDescribedBy: messageId,
      maxWidth: 'min(440px, calc(100vw - 32px))',
    });
    return new Promise((resolve) =>
      dialog.afterClosed().subscribe((confirmed) => resolve(confirmed === true)),
    );
  }
}
