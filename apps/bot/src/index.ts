import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { runPriceCheck, type NightSummary } from './run';
import { workerServices } from './services';

// The "simply-sub-bot" Worker (BLUEPRINT §6.4, §7.7, M8.3): at 03:00 UTC its cron trigger starts the night's Workflow,
// which checks the catalog's pages step by step and opens or refreshes one pull request. Nothing here merges.

/** Each step is retried twice, a little later each time, before the night goes on without it. */
const stepConfig = {
  retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

interface NightParams {
  /** The night's date, UTC: the pull request's title. */
  date: string;
}

export class PriceCheck extends WorkflowEntrypoint<Env, NightParams> {
  override async run(event: WorkflowEvent<NightParams>, step: WorkflowStep): Promise<NightSummary> {
    return runPriceCheck(
      event.payload.date,
      // Steps pass plain data (run.ts), which Workflows keep as JSON.
      (name, task) => step.do(name, stepConfig, task as never) as never,
      workerServices(this.env),
    );
  }
}

export default {
  async scheduled(controller, env) {
    const date = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    // One instance a night: its id is the date, so a second trigger the same day starts nothing new.
    await env.PRICE_CHECK.create({ id: `price-check-${date}`, params: { date } });
  },
} satisfies ExportedHandler<Env>;
