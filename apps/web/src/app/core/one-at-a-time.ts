/**
 * `task`, run one at a time: a call while a run is going gets the run that follows it (one for every call made
 * meanwhile), which sees whatever changed during the first. For checks that must never overlap, such as a download
 * and its save. `task` mustn't reject.
 */
export function oneAtATime<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined;
  let queued: Promise<T> | undefined;
  const run = (): Promise<T> => {
    if (!running) {
      running = task().finally(() => (running = undefined));
      return running;
    }
    queued ??= running.then(() => {
      queued = undefined;
      return run();
    });
    return queued;
  };
  return run;
}
