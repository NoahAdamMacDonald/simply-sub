// How the app writes the day a catalog was built, in English like the rest of its text, in the user's time zone.

const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const date = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Oct 22", for the offline banner. */
export function catalogDay(generatedAt: string): string {
  return day.format(new Date(generatedAt));
}

/** "Oct 22, 2026", for Settings. */
export function catalogDate(generatedAt: string): string {
  return date.format(new Date(generatedAt));
}
