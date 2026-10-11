/**
 * One window's crossings, gathered across every drain that fed it: a spec
 * file's, or a case's inside it. The recorder keeps one per owner and one per
 * case, and both are folded the same way, the way every join of a journal is.
 */

import { enterModules, enteredModules, type EnteredModules, type ExecutedModule } from '@variance-authority/sense/journal';

export interface Accumulated extends EnteredModules {
  complete: boolean;
}

/** An accumulation that has seen nothing yet, and so has missed nothing. */
export function accumulation(): Accumulated {
  return { ...enteredModules(), complete: true };
}

/** Fold one drained window into an accumulation, keeping each way a region was entered apart. */
export function absorb(accumulated: Accumulated, journal: { modules: readonly ExecutedModule[] }): void {
  enterModules(accumulated, journal.modules);
}
