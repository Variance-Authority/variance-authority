/**
 * Case indexes spelled the way a fold writes them, and read back, for the
 * tests that lay one run's index over another.
 */

import type { CaseRunFiles } from '../case-layer.js';
import { CrossingSets } from '../crossing-sets.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { encodeSetExecutionIndex, type SetExecutionModule } from '../execution-set-format.js';
import { NO_OWNER } from '../format-layout.js';

/** A run that announced `files`, finished `finished` of them, in a checkout that lacks `absent`. */
export function ran(files: readonly string[], finished: readonly string[] = files, absent: readonly string[] = []): CaseRunFiles {
  return { ran: new Set(files), finished: new Set(finished), present: (file) => !absent.includes(file) };
}

/** The lines a layer's one module stands its regions on. */
export function linesOf(layer: Uint8Array | undefined): number[] {
  return decodeExecutionIndex(layer!).modules[0]!.blocks.map((block) => block.startLine);
}

/** A region with its lines: kind, name, first and last line, the cases that called it, and whether it ran while the module loaded. */
type Nested = readonly [kind: string, name: string, lines: readonly [number, number], callers: readonly string[], loaded?: boolean];

/**
 * One module cut into regions that nest, as a function's resumptions sit in its
 * continuation. A region's owner is the one whose path its own extends by one
 * step, the region around it the cut recorded; the outermost has none.
 */
export function nestedAt(cases: readonly string[], file: string, regions: readonly Nested[]): Buffer {
  const tests = cases.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const at = new Map(cases.map((id, position) => [id, position]));
  const named = new Map(regions.map(([, name], position) => [name, position]));
  const ownerOf = (name: string): number =>
    name === '' ? NO_OWNER : named.get(name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '')!;
  const module: SetExecutionModule = {
    file,
    blocks: regions.map(([kind, name, [startLine, endLine]]) => ({ kind, name, path: name, startLine, endLine, source: true })),
    called: Uint32Array.from(regions, ([, , , callers]) => sets.intern(callers.map((id) => at.get(id)!))),
    loaded: Uint8Array.from(regions, ([, , , , loaded]) => (loaded ? 1 : 0)),
    owner: Uint32Array.from(regions, ([, name]) => ownerOf(name)),
  };
  return encodeSetExecutionIndex({ tests, modules: [module], sets: sets.pool() });
}
