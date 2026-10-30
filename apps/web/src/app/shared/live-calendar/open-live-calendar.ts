import type { Injector } from '@angular/core';

/** Opens the live calendar's dialog (PROJECT-PLAN P10, P13, M10.3), which loads with it, from Sync calendar or Settings. */
export async function openLiveCalendar(injector: Injector): Promise<void> {
  const [{ MatDialog }, { LiveCalendarDialog }] = await Promise.all([
    import('@angular/material/dialog'),
    import('./live-calendar-dialog'),
  ]);
  injector.get(MatDialog).open(LiveCalendarDialog, {
    autoFocus: 'first-heading',
    maxWidth: 'min(600px, calc(100vw - 32px))',
    width: '600px',
  });
}
