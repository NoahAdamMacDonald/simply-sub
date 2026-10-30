import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { until } from '../../core/storage/storage.testing';
import { openSnack } from './snack';

// The app's snackbars (the feedback after M10, part 2): a message, its action, and ✕; Escape closes one too, unless
// something above it took the key; its time runs only while it isn't hovered or focused.

describe('openSnack', () => {
  let snackBar: MatSnackBar;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    snackBar = TestBed.inject(MatSnackBar);
  });

  afterEach(async () => {
    vi.useRealTimers();
    snackBar.dismiss();
    await settle();
  });

  const container = () => document.querySelector<HTMLElement>('.mat-mdc-snack-bar-container');
  const button = (name: string) =>
    Array.from(container()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (candidate) =>
        candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name,
    );

  async function settle(): Promise<void> {
    await TestBed.inject(ApplicationRef).whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }

  async function shown(message: string, action?: string, duration?: number) {
    const ref = openSnack(snackBar, message, action, duration === undefined ? {} : { duration });
    await until(() => container() !== null);
    await settle();
    return ref;
  }

  it('shows the message, its action and ✕, the action closing it as an action', async () => {
    const ref = await shown('Removed Netflix Standard', 'Undo');
    expect(
      container()?.querySelector('ss-snack .mat-mdc-snack-bar-label')?.textContent?.trim(),
    ).toBe('Removed Netflix Standard');
    expect(
      Array.from(container()?.querySelectorAll('button') ?? [], (one) =>
        [one.textContent?.trim(), one.getAttribute('aria-label')].join(' / '),
      ),
    ).toEqual(['Undo / ', 'close / Dismiss']);

    const action = vi.fn();
    ref.onAction().subscribe(action);
    button('Undo')?.click();
    await until(() => container() === null);
    expect(action).toHaveBeenCalledOnce();
  });

  it('closes on ✕ without the action, and has only ✕ when there’s no action', async () => {
    const ref = await shown('Catalog updated');
    expect(container()?.querySelectorAll('button')).toHaveLength(1);
    const action = vi.fn();
    const dismissed = vi.fn();
    ref.onAction().subscribe(action);
    ref.afterDismissed().subscribe(dismissed);

    button('Dismiss')?.click();
    await until(() => container() === null);
    expect(action).not.toHaveBeenCalled();
    expect(dismissed).toHaveBeenCalledWith({ dismissedByAction: false });
  });

  it('closes on Escape, unless something above it took the key', async () => {
    await shown('Saved Work Related', 'Undo');
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    await settle();
    expect(container()).not.toBeNull();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => container() === null);
  });

  it('puts focus back where it came from when ✕ or Escape closes it from inside', async () => {
    const page = document.body.appendChild(document.createElement('button'));
    page.textContent = 'On the page';
    try {
      for (const close of [
        () => button('Dismiss')?.click(),
        () =>
          document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          ),
      ]) {
        page.focus();
        await shown('Deleted Family', 'Undo');
        button('Undo')?.focus();
        close();
        await until(() => container() === null);
        expect(document.activeElement).toBe(page);
      }
    } finally {
      page.remove();
    }
  });

  it('goes after its time, which stops while it’s hovered or focused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    openSnack(snackBar, 'Deleted Family', 'Undo', { duration: 10_000 });
    await vi.waitFor(() => expect(container()).not.toBeNull());
    const host = container()!.querySelector('ss-snack')!;

    host.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(30_000);
    expect(container()).not.toBeNull();
    host.dispatchEvent(new MouseEvent('mouseleave'));

    // Focus moving from Undo to ✕ keeps it held.
    button('Undo')?.focus();
    button('Dismiss')?.focus();
    vi.advanceTimersByTime(30_000);
    expect(container()).not.toBeNull();
    button('Dismiss')?.blur();

    vi.advanceTimersByTime(9_999);
    expect(container()).not.toBeNull();
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await until(() => container() === null);
  });

  it('stays until it’s closed when it has no time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    openSnack(snackBar, "Some saved data couldn't be read, so it's hidden. The rest is fine.");
    await vi.waitFor(() => expect(container()).not.toBeNull());
    vi.advanceTimersByTime(600_000);
    expect(container()).not.toBeNull();
  });
});
