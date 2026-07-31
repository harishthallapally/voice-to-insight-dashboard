let transcriptionChain: Promise<unknown> = Promise.resolve();

export function runTranscriptionTask<T>(task: () => Promise<T>): Promise<T> {
  const run = transcriptionChain.then(task, task);
  transcriptionChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
