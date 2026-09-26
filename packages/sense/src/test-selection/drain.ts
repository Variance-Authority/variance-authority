/**
 * Taking a driven page's journal out of the page.
 *
 * Split from `journal.ts`, which turns a journal into the index, because this
 * half runs against a page and that half against the disk.
 */

import { EXECUTION_GLOBAL, type ExecutionCollector, type ExecutionJournal } from './probes.js';

/** The one thing a driver has to be able to do, so nothing here imports a driver. */
export interface EvaluatingPage {
  evaluate<Result, Argument>(
    body: (argument: Argument) => Result,
    argument: Argument,
  ): Promise<Result>;
}

/**
 * Take everything the page entered since the last drain.
 *
 * `undefined` means the page has no collector — an application built without
 * {@link testSelectionProbes}, which is the ordinary case and not an error.
 * The distinction is kept here rather than defaulted to an empty journal,
 * because "recorded nothing" and "recorded that nothing ran" are the two facts a
 * later selection must never confuse.
 */
export async function drainExecution(page: EvaluatingPage): Promise<ExecutionJournal | undefined> {
  return page.evaluate((global: string) => {
    const collector = (globalThis as unknown as Record<string, ExecutionCollector | undefined>)[
      global
    ];
    return collector === undefined ? undefined : collector.drain();
  }, EXECUTION_GLOBAL);
}
