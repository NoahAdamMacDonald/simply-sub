import { ApplicationRef, ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GlobalErrorHandler } from './global-error-handler';

describe('GlobalErrorHandler', () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ErrorHandler, useClass: GlobalErrorHandler },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    handler = TestBed.inject(ErrorHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Lets the snackbar load and render, or finish closing. */
  async function settle() {
    await TestBed.inject(ApplicationRef).whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }

  it('logs the error to the console and shows "Something went wrong"', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');

    handler.handleError(error);
    await settle();

    expect(consoleError).toHaveBeenCalledWith('ERROR', error);
    expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
      'Something went wrong',
    );
  });

  it('shows one message at a time, and a new one once it has closed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const snackBar = TestBed.inject(MatSnackBar);
    const open = vi.spyOn(snackBar, 'open');

    handler.handleError(new Error('first'));
    handler.handleError(new Error('second'));
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(2);

    snackBar.dismiss();
    await settle();
    handler.handleError(new Error('third'));
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
