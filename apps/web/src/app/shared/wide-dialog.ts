import { BreakpointObserver } from '@angular/cdk/layout';
import { DestroyRef, inject } from '@angular/core';
import type { MatDialogConfig, MatDialogRef } from '@angular/material/dialog';

// Dialogs with fields side by side (the item dialog, P6, and the custom subscription editor, P12): up to 720 px wide,
// past Material's 560 px, and the whole screen under 600 px. styles.scss styles the panel (ss-wide-dialog).

/** How a wide dialog opens. Focus starts on its heading, so a screen reader begins there. */
export const wideDialogConfig: MatDialogConfig = {
  panelClass: 'ss-wide-dialog',
  width: 'min(720px, calc(100vw - 32px))',
  maxWidth: '100vw',
  autoFocus: 'first-heading',
};

const narrow = '(max-width: 599.98px)';

/** Makes a wide dialog fill the screen under 600 px, as the window changes. Call it in the dialog's constructor. */
export function fillScreenWhenNarrow(dialogRef: MatDialogRef<unknown>): void {
  const subscription = inject(BreakpointObserver)
    .observe(narrow)
    .subscribe(({ matches }) => {
      if (matches) {
        dialogRef.addPanelClass('ss-dialog-full-screen');
        dialogRef.updateSize('100vw', '100%');
      } else {
        dialogRef.removePanelClass('ss-dialog-full-screen');
        dialogRef.updateSize(wideDialogConfig.width, '');
      }
    });
  inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
}
