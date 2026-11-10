import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NightContinues, partSteps } from './night';
import { Requests } from './requests';
import { runNight, type NightSummary } from './run';
import { workerServices } from './services';

// The "simply-sub-bot" Worker (BLUEPRINT §6.4, §6.5, §7.7; M8.3, M3.9 to M3.11): at 03:00 UTC its cron trigger starts
// the night's Workflow, which checks what data/automation.yaml says is due, step by step, opens or refreshes the week's
// digest on its day, and goes on with the discovery's batch. Nothing here merges. A Workflow instance sends at most 50
// requests out on the free plan, so a night runs in parts (night.ts): an instance each, the next started by the last.

/** Each step is retried twice, a little later each time, before the night goes on without it. */
const stepConfig = {
  retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

/** The most parts a night takes: a night's checks and digest fit in a few, and a runaway one stops here. */
export const maxParts = 20;

interface NightParams {
  /** The night's date, UTC: the pull request's title. */
  date: string;
  /** Which part of the night this instance is, from 1. */
  part?: number;
}

/** Each part's instance id: the date's for the first, so a second trigger the same day starts nothing new. */
export function partId(date: string, part: number): string {
  return part === 1 ? `price-check-${date}` : `price-check-${date}-${part}`;
}

export class PriceCheck extends WorkflowEntrypoint<Env, NightParams> {
  override async run(
    event: WorkflowEvent<NightParams>,
    step: WorkflowStep,
  ): Promise<NightSummary & { part: number; goesOnFrom?: string }> {
    const { date, part = 1 } = event.payload;
    const requests = new Requests();
    const services = workerServices(this.env, requests);
    // A later part reads what the earlier ones' steps returned from KV, which can take a minute to reach every place.
    if (part > 1) await step.sleep('let the last part’s results reach KV', '1 minute');
    const steps = partSteps(
      // Steps pass plain data (run.ts), which Workflows keep as JSON.
      (name, task) => step.do(name, stepConfig, task as never) as never,
      requests,
      services.state.night(date, part > 1),
    );
    try {
      return { ...(await runNight(date, steps, services)), part };
    } catch (error) {
      if (!(error instanceof NightContinues)) throw error;
      if (part >= maxParts) {
        throw new Error(`The night stopped at ${error.step}: ${maxParts} parts`, { cause: error });
      }
      await step.do(`go on in part ${part + 1}`, async () => {
        await this.env.PRICE_CHECK.create({
          id: partId(date, part + 1),
          params: { date, part: part + 1 },
        });
      });
      return { findings: 0, part, goesOnFrom: error.step };
    }
  }
}

export default {
  async scheduled(controller, env) {
    const date = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    await env.PRICE_CHECK.create({ id: partId(date, 1), params: { date } });
  },
} satisfies ExportedHandler<Env>;
