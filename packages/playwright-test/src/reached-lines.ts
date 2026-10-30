/**
 * The spec line that first reached each region of a case, as the recorder
 * gathers it from the drains of a cut spec ([`documents.ts`](./documents.ts)).
 *
 * Every drain before a statement hands over the line that ran since the drain
 * before; what it finds that the case had not reached is charged to that line.
 */

import type { ExecutedModule, ObservedCase } from '@variance-authority/sense/journal';
import type { Accumulated } from './accumulated.js';

export interface ReachedLines {
  /**
   * Charge each region a window holds to `line`, unless the case reached it
   * before: under an earlier line, or under none, which is ambient and stays so.
   * `hook` says `line` is a hook's statement.
   */
  readonly charge: (key: string, before: Accumulated, modules: readonly ExecutedModule[], line: number, hook: boolean) => void;
  /** The lines a case was drained with, as {@link ObservedCase.lines} carries them; none for one never charged. */
  readonly of: (key: string) => ObservedCase['lines'];
}

/** A test line, and whether it is a hook's statement. */
interface Line {
  readonly line: number;
  readonly hook: boolean;
}

/** The lines of every case one worker drains, by the key its cases are held under. */
export function reachedLines(): ReachedLines {
  // By case, then module and ordinal: present only for a case drained with a line.
  const reached = new Map<string, Map<string, Map<number, Line>>>();
  return {
    charge: (key, before, modules, line, hook) => {
      const held = reached.get(key) ?? new Map<string, Map<number, Line>>();
      reached.set(key, held);
      for (const module of modules) {
        const ordinals = held.get(module.id) ?? new Map<number, Line>();
        held.set(module.id, ordinals);
        const seen = before.hits.get(module.id);
        for (const ordinal of module.hits) if (seen?.has(ordinal) !== true) ordinals.set(ordinal, { line, hook });
      }
    },
    of: (key) => {
      const held = reached.get(key);
      if (held === undefined) return undefined;
      return [...held]
        .filter(([, ordinals]) => ordinals.size > 0)
        .map(([id, ordinals]) => {
          const sorted = [...ordinals].sort(([left], [right]) => left - right);
          const hits = sorted.map(([ordinal]) => ordinal);
          const lines = sorted.map(([, at]) => at.line);
          return sorted.some(([, at]) => at.hook) ? { id, hits, lines, ambient: sorted.map(([, at]) => at.hook) } : { id, hits, lines };
        });
    },
  };
}
