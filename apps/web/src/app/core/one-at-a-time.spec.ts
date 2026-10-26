import { oneAtATime } from './one-at-a-time';

describe('oneAtATime', () => {
  /** A task whose runs the test finishes one by one. */
  function controlled() {
    const finishers: (() => void)[] = [];
    let runs = 0;
    const task = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          const run = ++runs;
          finishers.push(() => resolve(run));
        }),
    );
    return { task, finish: () => finishers.shift()?.() };
  }

  it('runs the task when nothing is running', async () => {
    const { task, finish } = controlled();
    const run = oneAtATime(task);
    const first = run();
    finish();
    expect(await first).toBe(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('gives calls made during a run the one run that follows it', async () => {
    const { task, finish } = controlled();
    const run = oneAtATime(task);
    const first = run();
    const second = run();
    const third = run();
    expect(task).toHaveBeenCalledTimes(1);

    finish();
    expect(await first).toBe(1);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    finish();
    expect(await Promise.all([second, third])).toEqual([2, 2]);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('starts afresh once everything has run', async () => {
    const { task, finish } = controlled();
    const run = oneAtATime(task);
    const first = run();
    finish();
    await first;
    const again = run();
    finish();
    expect(await again).toBe(2);
  });
});
