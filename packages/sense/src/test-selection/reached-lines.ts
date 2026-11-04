/**
 * The lines a driver hands over with a case, folded into the column the case
 * index stores ([`case-lines.ts`](./case-lines.ts)).
 *
 * A driver that cut the test file says, per module, which test line first
 * reached each region the case entered. It says it in the module's own
 * ordinals; the index reads a region by its place among the written regions,
 * so the fold translates one into the other.
 */

import type { ModuleId } from '../instrument/index.js';
import { CaseLinesBuilder, lineValue, type CaseLines } from './case-lines.js';

/**
 * Of one module, the test line that first reached each region: `lines[at]`
 * reached `hits[at]`, and `ambient[at]` says the line is a hook's statement.
 * Absent `ambient` says no line is a hook's.
 */
export interface ReachedLines {
  readonly id: ModuleId;
  readonly hits: readonly number[];
  readonly lines: readonly number[];
  readonly ambient?: readonly boolean[];
}

/** The lines of one case across two frames: the first frame to reach a region keeps it. */
export function linesAcross(
  first: readonly ReachedLines[] | undefined,
  second: readonly ReachedLines[] | undefined,
): { readonly lines?: readonly ReachedLines[] } {
  if (first === undefined && second === undefined) return {};
  return { lines: [...(first ?? []), ...(second ?? [])] };
}

/** One module of the index, as the fold reads it. */
export interface IndexedModule {
  readonly id: ModuleId;
  /** Each written region's ordinal, by its place in `blocks`. */
  readonly ordinals: readonly number[];
  readonly blocks: readonly { readonly crossings: readonly { readonly test: number }[] }[];
}

/**
 * Each case's lines over the index's modules, `undefined` for a case its
 * driver did not cut.
 *
 * A cut case holds a value for every region it crossed: the line that first
 * reached it, or line 0, ambient, for one it crossed without a line, such as a
 * region only its teardown drained.
 */
export function linesOverIndex(
  cases: readonly (readonly ReachedLines[] | undefined)[],
  modules: readonly IndexedModule[],
): readonly (CaseLines | undefined)[] {
  const reached = cases.map((lines) => (lines === undefined ? undefined : reachedAt(lines)));
  const builders = reached.map((lines) => (lines === undefined ? undefined : new CaseLinesBuilder()));
  for (const [place, { id, ordinals, blocks }] of modules.entries()) {
    for (const [block, { crossings }] of blocks.entries()) {
      for (const { test } of crossings) {
        const line = reached[test]?.get(id)?.get(ordinals[block]!);
        builders[test]?.add(place, block, lineValue(line?.line ?? 0, line === undefined || line.ambient));
      }
    }
  }
  return builders.map((builder) => builder?.finish());
}

/** Each module's region ordinals, to the line that first reached each. */
function reachedAt(lines: readonly ReachedLines[]): Map<ModuleId, Map<number, { line: number; ambient: boolean }>> {
  const reached = new Map<ModuleId, Map<number, { line: number; ambient: boolean }>>();
  for (const { id, hits, lines: at, ambient } of lines) {
    const byOrdinal = reached.get(id) ?? new Map<number, { line: number; ambient: boolean }>();
    for (const [index, ordinal] of hits.entries()) {
      if (!byOrdinal.has(ordinal)) byOrdinal.set(ordinal, { line: at[index]!, ambient: ambient?.[index] === true });
    }
    reached.set(id, byOrdinal);
  }
  return reached;
}
