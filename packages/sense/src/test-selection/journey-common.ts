/**
 * What every subject of a head depends on, and how far along it each listener
 * has been told.
 *
 * What the process did outside any journey is every subject's, and so is what
 * a module did while a request was the first to need it evaluated. A listener
 * that first hears from a head late — a second worker, a run against a server
 * an earlier run started, a watcher attached to an application already serving
 * — is told everything before it, which it depends on and would otherwise
 * never see.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { ModuleId } from '../instrument/index.js';
import type { ExecutedModule } from './probes.js';

export interface CommonCrossings {
  /** Keep the ordinals `of` picks from each module, in the order they first arrive. */
  readonly keep: (
    modules: readonly ExecutedModule[],
    of: (module: ExecutedModule) => readonly number[],
  ) => void;
  /** What `home` has not been told yet, or undefined when it has heard everything. */
  readonly since: (home: string) => ExecutedModule[] | undefined;
}

/** A ledger that remembers how far `homes` listeners have been told, most recent last. */
export function commonCrossings(homes: number): CommonCrossings {
  const common = new Map<ModuleId, Set<number>>();
  const kept: (readonly [ModuleId, number])[] = [];
  const told = new Map<string, number>();
  return {
    keep: (modules, of) => {
      for (const module of modules) {
        let ordinals = common.get(module.id);
        for (const ordinal of of(module)) {
          if (ordinals === undefined) common.set(module.id, (ordinals = new Set()));
          if (ordinals.has(ordinal)) continue;
          ordinals.add(ordinal);
          kept.push([module.id, ordinal]);
        }
      }
    },
    since: (home) => {
      const from = told.get(home) ?? 0;
      if (from === kept.length) return undefined;
      told.delete(home);
      told.set(home, kept.length);
      if (told.size > homes) told.delete(told.keys().next().value!);
      const since = new Map<ModuleId, number[]>();
      for (const [id, ordinal] of kept.slice(from)) {
        const ordinals = since.get(id);
        if (ordinals === undefined) since.set(id, [ordinal]);
        else ordinals.push(ordinal);
      }
      return [...since]
        .map(([id, hits]) => ({ id, hits: hits.sort((left, right) => left - right), shared: [] }))
        .sort((left, right) => codeUnitOrder(left.id, right.id));
    },
  };
}
