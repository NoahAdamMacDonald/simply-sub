import { Injector, Service, effect, inject, untracked } from '@angular/core';
import { SettingsStore } from './settings-store';

/**
 * Opens the first-run dialog (PROJECT-PLAN P1) once the settings have loaded and none are saved, so it never flashes
 * up while they load. It comes back whenever that's so again (in-memory mode on each visit, Delete all data in M6.9).
 * The dialog and Material's dialog load only then, which keeps them out of the initial bundle.
 */
@Service()
export class FirstRun {
  private readonly injector = inject(Injector);
  // Not a signal: the dialog closes as soon as the save resolves, before the live query has the new settings, and
  // the effect mustn't run again in between.
  private showing = false;

  constructor() {
    const settings = inject(SettingsStore);
    effect(() => {
      if (settings.needsFirstRun() && !this.showing) untracked(() => void this.show());
    });
  }

  private async show(): Promise<void> {
    this.showing = true;
    try {
      const [{ MatDialog }, { FirstRunDialog }] = await Promise.all([
        import('@angular/material/dialog'),
        import('../../features/settings/first-run-dialog'),
      ]);
      const dialog = this.injector.get(MatDialog).open(FirstRunDialog, {
        disableClose: true,
        maxWidth: 'min(560px, calc(100vw - 32px))',
        width: '560px',
      });
      await new Promise<void>((resolve) => dialog.afterClosed().subscribe(() => resolve()));
    } finally {
      this.showing = false;
    }
  }
}
