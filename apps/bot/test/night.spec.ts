import { describe, expect, it } from 'vitest';
import { ChecksWait, NightContinues, partSteps, type RunStep } from '../src/night';
import { Requests } from '../src/requests';
import { memoryState, type Pending } from '../src/state';
import { Writes } from '../src/writes';

// A night in parts (BLUEPRINT §6.4): a Workflow instance sends at most 50 requests out on the free plan, and the nights
// of 2026-11-07 to 2026-11-09 failed every check after robots.txt with "Too many subrequests". Each step now gets what's
// left of the part's requests, and one that would pass it stops the part; the next part skips what the last finished.

const date = '2026-11-10';

/** Runs a step at once, as a Workflow does the first time, noting its name. */
function runner(names: string[]): RunStep {
  return async (name, task) => {
    names.push(name);
    return task();
  };
}

/** A part's world: its counted requests (each one noted by URL), its steps and the night's memo in `state`. */
function part(state: ReturnType<typeof memoryState>, read: boolean, limit: number) {
  const sent: string[] = [];
  const requests = new Requests(async (input) => {
    sent.push(String(input));
    return new Response('ok');
  });
  const names: string[] = [];
  const step = partSteps(runner(names), requests, state.night(date, read), limit);
  /** A step that sends `count` requests and returns its name. */
  const sends = (name: string, count: number) =>
    step(name, async () => {
      for (let at = 0; at < count; at++) await requests.fetch(`https://example.com/${name}/${at}`);
      return name;
    });
  return { sent, names, step, sends, requests };
}

describe('a night in parts', () => {
  it('runs each step within the part’s requests, and keeps what it returned', async () => {
    const state = memoryState();
    const first = part(state, false, 10);
    expect(await first.sends('read the repository', 4)).toBe('read the repository');
    expect(await first.sends('check netflix', 6)).toBe('check netflix');
    expect(first.sent).toHaveLength(10);
    expect(await state.night(date, true).get('check netflix')).toEqual({ value: 'check netflix' });
  });

  it('stops a part before the request past it, and the next part goes on from that step', async () => {
    const state = memoryState();
    const first = part(state, false, 10);
    await first.sends('read the repository', 4);
    await first.sends('check mullvad', 5);
    await expect(first.sends('check netflix', 6)).rejects.toEqual(
      new NightContinues('check netflix'),
    );
    // The request that would have passed the part's 10 was never sent.
    expect(first.sent).toHaveLength(10);

    const second = part(state, true, 10);
    expect(await second.sends('read the repository', 4)).toBe('read the repository');
    expect(await second.sends('check mullvad', 5)).toBe('check mullvad');
    expect(await second.sends('check netflix', 6)).toBe('check netflix');
    // What the first part finished costs the second nothing; the step it stopped at runs whole.
    expect(second.names).toEqual(['check netflix']);
    expect(second.sent).toHaveLength(6);
  });

  it('fails a step that needs more than a whole part, rather than going on for ever', async () => {
    const first = part(memoryState(), false, 10);
    const error = await first.sends('survey a big site', 11).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(NightContinues);
    expect(error).toEqual(
      new Error('survey a big site needs more than the 10 requests a part has'),
    );
  });

  it('keeps a failure, so a later part fails the step at once rather than trying it again', async () => {
    const state = memoryState();
    const first = part(state, false, 10);
    await expect(
      first.step('check rumble', async () => {
        throw new Error('D1 is unavailable');
      }),
    ).rejects.toThrow('D1 is unavailable');
    const second = part(state, true, 10);
    let tried = false;
    await expect(
      second.step('check rumble', async () => {
        tried = true;
        return 'checked';
      }),
    ).rejects.toThrow('D1 is unavailable');
    expect(tried).toBe(false);
  });

  it('counts a failed try’s requests, which no result records', async () => {
    const first = part(memoryState(), false, 10);
    const failing = first.step('read the settings', async () => {
      for (let at = 0; at < 6; at++) await first.requests.fetch(`https://api.github.com/${at}`);
      throw new Error('GitHub answered 502');
    });
    await expect(failing).rejects.toThrow('GitHub answered 502');
    // Its six were sent: the part has four left.
    await expect(first.sends('check netflix', 5)).rejects.toEqual(
      new NightContinues('check netflix'),
    );
    expect(first.sent).toHaveLength(10);
  });

  describe('the night’s KV writes', () => {
    const entry: Pending = {
      key: 'https://netflix.com/signup/planform',
      seen: date,
      findings: [{ kind: 'manual', subject: 'netflix', reason: 'A test finding.' }],
    };

    it('leaves a page check for another night once they’re spent, but not a step every night needs', async () => {
      const writes = new Writes();
      const state = memoryState(writes);
      const names: string[] = [];
      const step = partSteps(runner(names), new Requests(), state.night(date, false), 10, {
        writes,
        before: 0,
        budget: 3,
      });
      // The entry, and the step's result kept for the next part: two writes.
      await step('check mullvad', async () => (await state.putPending(entry), 'checked'), {
        mayWait: true,
      });
      expect(step.writes()).toBe(2);
      await step('check netflix', async () => 'checked', { mayWait: true });
      expect(step.writes()).toBe(3);
      await expect(
        step('check proton-vpn', async () => 'checked', { mayWait: true }),
      ).rejects.toEqual(new ChecksWait('writes'));
      expect(await step('save the check dates', async () => 'saved')).toBe('saved');
      expect(names).toEqual(['check mullvad', 'check netflix', 'save the check dates']);
      expect(step.writes()).toBe(4);
    });

    it('carries the count to the next part, which still takes the checks the last one finished', async () => {
      const writes = new Writes();
      const state = memoryState(writes);
      const first = partSteps(runner([]), new Requests(), state.night(date, false), 10, {
        writes,
        before: 0,
        budget: 2,
      });
      await first('check mullvad', async () => (await state.putPending(entry), 'checked'), {
        mayWait: true,
      });
      const names: string[] = [];
      const second = partSteps(runner(names), new Requests(), state.night(date, true), 10, {
        writes,
        before: first.writes(),
        budget: 2,
      });
      expect(await second('check mullvad', async () => 'again', { mayWait: true })).toBe('checked');
      await expect(
        second('check netflix', async () => 'checked', { mayWait: true }),
      ).rejects.toEqual(new ChecksWait('writes'));
      expect(names).toEqual([]);
      expect(second.writes()).toBe(2);
    });

    it('leaves page checks for another night past the parts they may take, but not the rest', async () => {
      const writes = new Writes();
      const state = memoryState(writes);
      const names: string[] = [];
      const step = partSteps(runner(names), new Requests(), state.night(date, false), 10, {
        writes,
        before: 0,
        part: 4,
        lastCheckPart: 3,
      });
      await expect(step('check netflix', async () => 'checked', { mayWait: true })).rejects.toEqual(
        new ChecksWait('parts'),
      );
      expect(await step('build the digest', async () => 'built')).toBe('built');
      expect(names).toEqual(['build the digest']);
    });
  });
});
