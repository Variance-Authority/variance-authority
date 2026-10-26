// compass: variance-authority.reach
/**
 * Which recorded regions a question about a piece of source lands on.
 *
 * `variance covering` asks the record about a line, a run of lines or a named
 * scope, and every reading of that question — the cases that entered, the ones
 * that stopped first, whether it ran while its module evaluated — has to land
 * on the same regions, so the landing is decided here once.
 *
 * A line lands where selection charges an edit to it ({@link blocksChargedAt}),
 * so the answer names every case a selection over that edit would run. A line
 * whose edit charges the module's own region is read at file grain: the record
 * says the module was loaded and nothing narrower, so its answer is every case
 * that loaded the file. That is a line only the module holds, and also the
 * first or last line of a function the module region encloses directly. A run
 * of lines lands on every region one of its lines is charged to, which is what
 * a selection over an edit to those lines runs.
 *
 * A scope is a name the instrumenter wrote at the recorded commit, so it needs
 * no parse of any text: a function's own name, a method's `Class/method`. The
 * name is the scope path the region was opened under, and a scope owns every
 * recorded function whose path continues it past a `/`. A string key holding a
 * `/` would spell a path it is not under; nothing else does.
 */

import { blocksChargedAt, type RegionLines } from './blocks-around.js';
import type { ExecutionBlock } from './reverse.js';

/** One piece of source a question names: a line, lines, or a scope, of one file. */
export type SourceTestTarget =
  | { readonly file: string; readonly line: number }
  /** Recorded lines, in the record's coordinates. */
  | { readonly file: string; readonly lines: readonly number[] }
  | { readonly file: string; readonly function: string };

/** A recorded region as this reading needs it. */
interface NamedRegion extends RegionLines {
  readonly name: string;
}

/**
 * The grain an answer about a line is read at: `file` when an edit to it
 * charges the module's own region — a line only the module holds, and a line
 * that opens or closes a function the module region encloses directly — so the
 * answer names every case that loaded the file; `region` when it charges only regions
 * narrower than that; absent when no region with source holds it.
 */
export function lineGrain(blocks: readonly RegionLines[], line: number): 'region' | 'file' | undefined {
  const charged = blocksChargedAt(blocks, line).filter((block) => block.source);
  if (charged.length === 0) return undefined;
  return charged.some((block) => block.kind === 'module') ? 'file' : 'region';
}

/** The recorded functions a scope owns: the one of its name, and every one written inside it. */
export function functionsUnder<Block extends NamedRegion>(blocks: readonly Block[], scope: string): readonly Block[] {
  return blocks.filter((block) =>
    block.source && block.kind === 'function' && (block.name === scope || block.name.startsWith(`${scope}/`)),
  );
}

/** The regions of one module a target lands on. */
export function blocksOfTarget<Block extends NamedRegion>(blocks: readonly Block[], target: SourceTestTarget): readonly Block[] {
  if ('function' in target) return functionsUnder(blocks, target.function);
  const lines = 'line' in target ? [target.line] : target.lines;
  const found = new Set<Block>();
  for (const line of lines) for (const block of blocksChargedAt(blocks, line)) found.add(block);
  return blocks.filter((block) => found.has(block));
}

/**
 * Whether the record marks load time on a target's blocks, or on any block of
 * the module without a target, on the block or on one of its crossings. Who
 * loaded them, and who only mocked them, is then the file graph's to say.
 */
export function marksLoadTime(blocks: readonly ExecutionBlock[], target?: SourceTestTarget): boolean {
  return (target === undefined ? blocks : blocksOfTarget(blocks, target))
    .some((block) => block.loaded === true || block.crossings.some((crossing) => crossing.loaded === true));
}
