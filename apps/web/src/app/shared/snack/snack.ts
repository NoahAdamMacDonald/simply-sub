import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  inject,
  type Injector,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MAT_SNACK_BAR_DATA,
  MatSnackBarAction,
  MatSnackBarActions,
  MatSnackBar,
  MatSnackBarLabel,
  MatSnackBarRef,
} from '@angular/material/snack-bar';

// The app's snackbars (the feedback after M10, part 2): a message, its action if it has one ("Undo"), and ✕, so any
// can be closed without its action, and Escape closes it too, with focus back where it was if it was in it. Its time
// runs only while the pointer and focus are elsewhere, so it doesn't go while it's being read or reached for.

/** How long a message shows, in ms, and one with Undo, which takes longer to reach. */
export const snackMillis = 5000;
export const undoMillis = 10_000;

export interface SnackData {
  message: string;
  /** Its button's text: the snackbar closes with it, and onAction() says it was pressed. */
  action?: string;
  /** How long it shows, in ms, counted while it isn't hovered or focused; none for until it's closed. */
  duration?: number;
}

@Component({
  selector: 'ss-snack',
  imports: [
    MatButton,
    MatIcon,
    MatIconButton,
    MatSnackBarAction,
    MatSnackBarActions,
    MatSnackBarLabel,
  ],
  templateUrl: './snack.html',
  styleUrl: './snack.scss',
  // Its styles place Material's container too, which is outside it. They load with it, out of the initial bundle.
  encapsulation: ViewEncapsulation.None,
  host: {
    '(document:keydown.escape)': 'escape($event)',
    '(mouseenter)': 'hold("pointer")',
    '(mouseleave)': 'release("pointer")',
    '(focusin)': 'entered($event)',
    '(focusout)': 'left($event)',
  },
})
export class Snack {
  protected readonly data = inject<SnackData>(MAT_SNACK_BAR_DATA);
  protected readonly ref = inject<MatSnackBarRef<Snack>>(MatSnackBarRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly held = new Set<'pointer' | 'focus'>();
  private timer?: ReturnType<typeof setTimeout>;
  /** What had focus before it came in here: it goes back there when ✕ or Escape closes the snackbar. */
  private cameFrom?: HTMLElement;

  constructor() {
    // Its time starts once it's in.
    this.ref.afterOpened().subscribe(() => this.release());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  /**
   * Escape closes it, unless something above it took the key first: a dialog's, a menu's or a list's own Escape
   * marks it handled, and those come before the document's.
   */
  protected escape(event: Event): void {
    if (!event.defaultPrevented) this.close();
  }

  /** ✕ or Escape: closes it, and puts focus back where it came from if it was in here. */
  protected close(): void {
    const inside = this.host.nativeElement.contains(this.document.activeElement);
    this.ref.dismiss();
    if (inside && this.cameFrom?.isConnected) this.cameFrom.focus();
  }

  protected entered(event: FocusEvent): void {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !this.host.nativeElement.contains(from))
      this.cameFrom = from;
    this.hold('focus');
  }

  protected hold(by: 'pointer' | 'focus'): void {
    this.held.add(by);
    clearTimeout(this.timer);
  }

  protected release(by?: 'pointer' | 'focus'): void {
    if (by) this.held.delete(by);
    const { duration } = this.data;
    if (this.held.size > 0 || duration === undefined) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ref.dismiss(), duration);
  }

  /** Focus left it, not just moved from its action to ✕. */
  protected left(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node && this.host.nativeElement.contains(next))) this.release('focus');
  }
}

/**
 * Shows `message` in a snackbar, with `action`'s button if there is one and ✕ (P1's toasts, the feedback after M10,
 * part 2), in place of MatSnackBar.open: Material's own has no way to close one with an action but its action. Code
 * that loads this file when it has something to say passes its injector.
 */
export function openSnack(
  snackBar: MatSnackBar | Injector,
  message: string,
  action?: string,
  { duration }: { duration?: number } = {},
): MatSnackBarRef<Snack> {
  // Injectors implement Injector rather than extend it, so the snack bar is the one to test for.
  const bar = snackBar instanceof MatSnackBar ? snackBar : snackBar.get(MatSnackBar);
  return bar.openFromComponent(Snack, {
    data: {
      message,
      ...(action !== undefined && { action }),
      ...(duration !== undefined && { duration }),
    } satisfies SnackData,
  });
}
