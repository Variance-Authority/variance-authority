/**
 * A captured module as coverage stores it: ordinals and offsets become lines.
 *
 * The capture side of this package speaks in byte offsets into whatever text
 * the transform was handed, because that is the only thing a transform can
 * know. A record is read by a diff, which speaks in lines of the file someone
 * edited. This is where the one becomes the other, and it is the only place
 * that conversion happens.
 */

import { digestString } from '../digest.js';
import type { Block } from '../instrument/index.js';
import type { CoverageBlock, CoverageModule } from './index.js';
import { codeUnitOrder, type CapturedModule } from './instrumented-modules.js';
import type { ExtentOf, RecordedFrame } from './source-lines.js';

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
 * `extentOf` is how the offsets get back to the file the author edited. Absent,
 * it counts newlines in whatever text the block was cut from — right for a
 * transform that moved nothing, and a different number line for one that did.
 * The seams supply the bundler's own map; see `source-lines.ts`. A region the
 * map gives no origin is recorded with no lines, never with the line the
 * transform happened to put it on.
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
  extentOf: ExtentOf = (start, last) => [lineAt(source, start), lineAt(source, last)],
): CoverageBlock {
  const extent = extentOf(block.start, block.end > block.start ? block.end - 1 : block.end);
  return {
    ordinal: block.ordinal,
    kind: block.kind,
    ...(block.owner === undefined ? {} : { owner: block.owner }),
    digest: block.digest,
    name: block.name,
    path: block.path,
    ...(extent === undefined ? {} : { startLine: Math.min(...extent), endLine: Math.max(...extent) }),
    source: block.end > block.start,
    testFiles: [],
  };
}

/**
 * Every block of one module as coverage records it, each digested from the
 * lines of the source it maps to.
 *
 * The addon digests a region from the text it instrumented, and one source has
 * as many texts as it has builds: a package's own tests load it through one
 * transform, every other package's tests load its build through another, and
 * both records are filed under the source with one source digest and one set of
 * lines. A digest of the emitted text would read every region as edited the
 * first time the two met in a merge. The lines are the one thing both builds
 * agree on, so the digest is cut from them: a region's own lines of `text`,
 * with the lines inside each region it owns left to that region. A region the
 * map gives no lines, and one with no source of its own, keeps the addon's.
 */
export function coverageBlocks(
  blocks: readonly Block[],
  frame: Pick<RecordedFrame, 'extentOf' | 'text'>,
): CoverageBlock[] {
  const rows = blocks.map((block) => coverageBlock(frame.text, block, frame.extentOf));
  const lines = frame.text.split('\n');
  const owned = new Map<number, CoverageBlock[]>();
  for (const row of rows) {
    if (row.owner === undefined || row.startLine === undefined || !row.source) continue;
    owned.set(row.owner, [...(owned.get(row.owner) ?? []), row]);
  }
  return rows.map((row) => {
    if (row.startLine === undefined || row.endLine === undefined || !row.source) return row;
    const own: string[] = [];
    let line = row.startLine;
    const inner = (owned.get(row.ordinal) ?? []).slice().sort((a, b) => a.startLine! - b.startLine!);
    for (const child of inner) {
      const from = Math.max(child.startLine! + 1, line);
      const to = Math.min(child.endLine! - 1, row.endLine);
      if (from > to) continue;
      own.push(...lines.slice(line - 1, from - 1), '\0');
      line = to + 1;
    }
    own.push(...lines.slice(line - 1, row.endLine));
    return { ...row, digest: digestString(own.join('\n')) };
  });
}

export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}
