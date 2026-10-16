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
 * only the module's own region holds is held at file grain: the record says
 * the module was loaded and nothing narrower, so its answer is every case that
 * loaded the file. A run of lines lands on every region one of its lines is
 * charged to, which is what a selection over an edit to those lines runs: a
 * range that crosses a function's first or last line already charges the
 * region around it.
 *
 * A scope is a name the instrumenter wrote at the recorded commit, so it needs
 * no parse of any text: a function's own name, a method's `Class/method`. The
 * name is the scope path the region was opened under, and a scope owns every
 * recorded function whose path continues it past a `/`. A string key holding a
 * `/` would spell a path it is not under; nothing else does.
 */

import { blocksChargedAt, type RegionLines } from './blocks-around.js';

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
 * The finest grain the record holds a line at: `region` when a region
 * narrower than the module's charges it, `file` when only the module's own
 * region does, absent when no region with source holds it.
 */
export function lineGrain(blocks: readonly RegionLines[], line: number): 'region' | 'file' | undefined {
  const charged = blocksChargedAt(blocks, line).filter((block) => block.source);
  if (charged.length === 0) return undefined;
  return charged.every((block) => block.kind === 'module') ? 'file' : 'region';
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
