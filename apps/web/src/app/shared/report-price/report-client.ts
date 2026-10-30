import type { PriceReport } from '@simply-sub/core';

// "Report a wrong price" (BLUEPRINT §5.2, PROJECT-PLAN M10.10, M10.11): POST /reports with the plan, the user's country
// and what's wrong, nothing else. The server counts it, and the bot checks the plan's pages that night.

/** What sending a report came to. */
export type ReportSent =
  | 'sent'
  /** No network, or no answer. */
  | 'offline'
  /** Too many reports from here this minute. */
  | 'busy'
  /** The server has taken all the reports it takes today. */
  | 'paused'
  | 'failed';

/** Sends `report`; offline, it sends nothing. */
export async function sendReport(report: PriceReport): Promise<ReportSent> {
  if (!navigator.onLine) return 'offline';
  let answer: Response;
  try {
    answer = await fetch('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    return 'offline';
  }
  if (answer.status === 202) return 'sent';
  if (answer.status === 429) return 'busy';
  if (answer.status === 503) return 'paused';
  return 'failed';
}
