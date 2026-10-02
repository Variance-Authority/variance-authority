/**
 * One window's crossings, gathered across every drain that fed it: a spec
 * file's, or a case's inside it. The recorder keeps one per owner and one per
 * case, and both are folded the same way.
 */

import type { ExecutedModule, ModuleId } from '@variance-authority/sense/journal';

export interface Accumulated {
  readonly hits: Map<ModuleId, Set<number>>;
  /** Of `hits`, the ordinals a module entered while evaluating: every spec's. */
  readonly shared: Map<ModuleId, Set<number>>;
  complete: boolean;
}

/** An accumulation that has seen nothing yet, and so has missed nothing. */
export function accumulation(): Accumulated {
  return { hits: new Map(), shared: new Map(), complete: true };
}

/** Fold one drained window into an accumulation, keeping evaluation apart. */
export function absorb(accumulated: Accumulated, journal: { modules: readonly ExecutedModule[] }): void {
  for (const module of journal.modules) {
    const ordinals = accumulated.hits.get(module.id) ?? new Set<number>();
    for (const ordinal of module.hits) ordinals.add(ordinal);
    accumulated.hits.set(module.id, ordinals);
    const shared = accumulated.shared.get(module.id) ?? new Set<number>();
    for (const ordinal of module.shared) shared.add(ordinal);
    accumulated.shared.set(module.id, shared);
  }
}
