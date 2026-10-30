import { ErrorHandler, Injector, Service, inject } from '@angular/core';

/**
 * Unexpected errors (PROJECT-PLAN P15): the details go to the console, the user sees
 * "Something went wrong", and nothing is sent anywhere.
 */
@Service({ autoProvided: false })
export class GlobalErrorHandler extends ErrorHandler {
  private readonly injector = inject(Injector);
  private messageShown = false;

  override handleError(error: unknown): void {
    super.handleError(error);
    // One message at a time, so a template that keeps failing can't reopen it on every render.
    if (this.messageShown) return;
    this.messageShown = true;
    // If the message can't be shown (say its chunk fails to load), the next error tries again.
    // Catching here also stops that failure from coming back to this handler.
    this.showMessage().catch(() => (this.messageShown = false));
  }

  private async showMessage(): Promise<void> {
    // Loaded on first use, so the snackbar and its overlay code stay out of the initial bundle.
    const { openSnack } = await import('../../shared/snack/snack');
    openSnack(this.injector, 'Something went wrong', undefined, { duration: 8000 })
      .afterDismissed()
      .subscribe(() => (this.messageShown = false));
  }
}
