/**
 * A captured module as coverage stores it: ordinals and offsets become lines.
 *
 * The capture side of this package speaks in byte offsets into whatever text
 * the transform was handed, because that is the only thing a transform can
 * know. A record is read by a diff, which speaks in lines of the file someone
 * edited. This is where the one becomes the other, and it is the only place
 * that conversion happens.
 */

import type { Block } from '../instrument/index.js';
import type { CoverageBlock, CoverageModule } from './index.js';
import { codeUnitOrder, type CapturedModule } from './instrumented-modules.js';

/** The coverage row a captured module makes once its crossings are known. */
export function coverageModule(
  module: CapturedModule,
  testFilesFor: (block: CoverageBlock) => readonly string[],
  loadedByFor: (block: CoverageBlock) => readonly string[] = () => [],
): CoverageModule {
  return {
    file: module.file,
    sourceDigest: module.sourceDigest,
    instrumented: module.instrumented,
    blocks: module.blocks.map((block) => {
      const loadedBy = [...loadedByFor(block)].sort(codeUnitOrder);
      return {
        ...block,
        testFiles: [...testFilesFor(block)].sort(codeUnitOrder),
        ...(loadedBy.length === 0 ? {} : { loadedBy }),
      };
    }),
  };
}

/**
 * One block as coverage records it: ordinals and offsets become lines.
 *
 * `lineOf` is how the offsets get back to the file the author edited. Absent, it
 * counts newlines in whatever text the block was cut from — right for a
 * transform that moved nothing, and a different number line for one that did.
 * The seams supply the bundler's own map; see `source-lines.ts`.
 *
 * The two ends are ordered after they are mapped, because a map answers one
 * position at a time and a transform is free to reorder. Solid's JSX compiler
 * hoists every element into a `_tmpl$` above the function that returns it, so a
 * region opening inside the template and closing at the original element site
 * maps to a lower line than it started on. Left inverted the record is refused
 * on read; clamped to the start it becomes a region one line tall, which selects
 * whatever wider region encloses it instead of itself. Both mapped lines are
 * places this region's own source was written, so the span between them is the
 * reading that neither loses the extent nor invents one.
 */
export function coverageBlock(
  source: string,
  block: Block,
  lineOf: (offset: number) => number = (offset) => lineAt(source, offset),
): CoverageBlock {
  const opens = lineOf(block.start);
  const closes = lineOf(block.end > block.start ? block.end - 1 : block.end);
  return {
    ordinal: block.ordinal,
    kind: block.kind,
    ...(block.owner === undefined ? {} : { owner: block.owner }),
    digest: block.digest,
    name: block.name,
    path: block.path,
    startLine: Math.min(opens, closes),
    endLine: Math.max(opens, closes),
    source: block.end > block.start,
    testFiles: [],
  };
}

export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}
