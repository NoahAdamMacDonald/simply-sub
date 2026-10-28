/** The calendar apps Sync calendar shows import steps for (P10, Phase 3). */
export type CalendarApp = 'google' | 'apple' | 'proton';

export const calendarApps: readonly { id: CalendarApp; name: string }[] = [
  { id: 'google', name: 'Google Calendar' },
  { id: 'apple', name: 'Apple Calendar' },
  { id: 'proton', name: 'Proton Calendar' },
];
