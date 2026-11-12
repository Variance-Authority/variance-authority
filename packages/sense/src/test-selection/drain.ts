/**
 * Taking a driven page's journal out of the page.
 *
 * Split from `journal.ts`, which turns a journal into the index, because this
 * half runs against a page and that half against the disk.
 */

import { DRIVEN_GLOBAL, EXECUTION_GLOBAL } from './execution-global.js';
import type { ExecutionCollector, ExecutionJournal } from './probes.js';

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
 *
 * Draining claims the page: one that reports itself stops, as
 * {@link claimPageSource} has it stop before it starts.
 */
export async function drainExecution(page: EvaluatingPage): Promise<ExecutionJournal | undefined> {
  return page.evaluate(([global, driven]: readonly [string, string]) => {
    const held = globalThis as unknown as Record<string, ExecutionCollector | true | undefined>;
    held[driven] = true;
    const collector = held[global] as ExecutionCollector | undefined;
    return collector === undefined ? undefined : collector.drain();
  }, [EXECUTION_GLOBAL, DRIVEN_GLOBAL] as const);
}

/**
 * A script that claims a page for the driver that installs it, to run before
 * the page does.
 *
 * A page that reports itself drains the collector a driver reads, so a driver
 * whose page may carry one says the page is driven before anything is drained;
 * a run that names no head leaves no cookie to say it.
 */
export function claimPageSource(): string {
  return `globalThis[${JSON.stringify(DRIVEN_GLOBAL)}] = true;`;
}
