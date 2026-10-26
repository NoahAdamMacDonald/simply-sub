import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { ConfirmService, type ConfirmOptions } from './confirm-service';

@Component({ template: '' })
class Host {}

const deleteList: ConfirmOptions = {
  title: 'Delete “Work Related”?',
  message: 'Its 12 subscriptions will be removed.',
  confirmText: 'Delete list',
  danger: true,
};

describe('ConfirmService', () => {
  let loader: HarnessLoader;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    loader = TestbedHarnessEnvironment.documentRootLoader(TestBed.createComponent(Host));
  });

  /** Asks, and gives the dialog once it's open. */
  async function ask(options: ConfirmOptions) {
    const answer = TestBed.inject(ConfirmService).confirm(options);
    let dialog: MatDialogHarness | undefined;
    await vi.waitFor(async () => {
      TestBed.tick();
      dialog = await loader.getHarness(MatDialogHarness);
    });
    return { answer, dialog: dialog as MatDialogHarness };
  }

  const button = (text: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('mat-dialog-container button')).find(
      (candidate) => candidate.textContent?.trim() === text,
    );

  it('shows the question as an alert dialog, named and described by its text', async () => {
    const { dialog, answer } = await ask(deleteList);
    expect(await dialog.getTitleText()).toBe('Delete “Work Related”?');
    expect(await dialog.getRole()).toBe('alertdialog');
    const describedBy = await dialog.getAriaDescribedby();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      'Its 12 subscriptions will be removed.',
    );
    await dialog.close();
    await answer;
  });

  it('resolves to true when confirmed', async () => {
    const { answer } = await ask(deleteList);
    button('Delete list')?.click();
    expect(await answer).toBe(true);
  });

  it('resolves to false on Cancel, and on Escape', async () => {
    const first = await ask(deleteList);
    button('Cancel')?.click();
    expect(await first.answer).toBe(false);

    const second = await ask(deleteList);
    await second.dialog.close();
    expect(await second.answer).toBe(false);
  });

  // jsdom has no layout, so the CDK finds nothing focusable there: the browser check sees the focus itself.
  it('starts on Cancel before a destructive action, and on the action otherwise', async () => {
    const danger = await ask(deleteList);
    expect(button('Cancel')?.hasAttribute('cdkFocusInitial')).toBe(true);
    expect(button('Delete list')?.hasAttribute('cdkFocusInitial')).toBe(false);
    button('Cancel')?.click();
    await danger.answer;

    const safe = await ask({ title: 'Apply?', message: 'One change.', confirmText: 'Apply' });
    expect(button('Apply')?.hasAttribute('cdkFocusInitial')).toBe(true);
    button('Apply')?.click();
    expect(await safe.answer).toBe(true);
  });
});
