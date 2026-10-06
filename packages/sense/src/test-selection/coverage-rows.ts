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
import { spliced, type InstrumentMode } from '../instrument/spliced.js';
import type { CoverageBlock, CoverageModule } from './index.js';
import { codeUnitOrder, type CapturedModule } from './instrumented-modules.js';
import { sourceLines, type ExtentOf, type RecordedFrame } from './source-lines.js';

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
  return digested(blocks.map((block) => coverageBlock(frame.text, block, frame.extentOf)), frame.text);
}

/**
 * Every block of one build as coverage records it, at the regions the source
 * the build was made from has.
 *
 * {@link coverageBlocks} reads a build's regions back through its map, and a
 * map is not the source. `tsc` erases the `import type` lines above the first
 * import, so a build's module opens at that import; it emits a call written
 * over several lines on one and maps the closing `)` to the line of the last
 * argument, so an `await` on that call ends a line short. Both readings are
 * filed under one text, and a merge keeps only the regions every reading of a
 * text cut: the module and the `await` fall out, and every case recorded on
 * them with them.
 *
 * So `text` — the source the frame reads, when it is not `built` — is walked
 * too. Where the build numbered the regions the source numbers, the record is
 * the source's own cut, which is what any other build of the text records. A
 * build that cut regions the source has not, such as a helper a bundler wrote,
 * keeps them where its map puts them, and its module opens and closes where the
 * source's does. A build with no text is framed as the file already.
 */
export function recordedBlocks(
  blocks: readonly Block[],
  frame: Pick<RecordedFrame, 'extentOf' | 'text' | 'file'>,
  built: string,
  mode: InstrumentMode,
): CoverageBlock[] {
  if (frame.text === built || built.trim() === '') return coverageBlocks(blocks, frame);
  const own = sourceCut(frame.text, frame.file, mode);
  if (own === undefined) return coverageBlocks(blocks, frame);
  const cut = own.rows;
  if (sameRegions(blocks, own.blocks)) return cut;
  // FIXME: only the module row takes the source's lines here; an `await` the
  // map closed a line short still ends there and falls out of a merge with the
  // source's cut. A build whose regions are named apart from its source's lands
  // here too: the walk names an arrow passed as a JSX attribute `anon#N` in the
  // source and after the property it became in the build.
  const [module, ...inside] = blocks.map((block) => coverageBlock(frame.text, block, frame.extentOf));
  const whole = cut[0]!;
  return digested([
    whole.startLine === undefined ? module! : { ...module!, startLine: whole.startLine, endLine: whole.endLine },
    ...inside,
  ], frame.text);
}

/**
 * `text` cut as a seam reading it records it: the walk's blocks, and the rows
 * they make at the text's own lines.
 */
export function sourceCut(
  text: string,
  file: string,
  mode: InstrumentMode,
): { readonly blocks: readonly Block[]; readonly rows: CoverageBlock[]; readonly sourceDigest: string } | undefined {
  const walked = spliced(text, file, mode);
  if (walked === undefined) return undefined;
  // One lookup for the whole module: the default counts newlines from the top
  // of the file on every offset, and a cut asks twice per region.
  const extentOf = sourceLines(text, undefined, file);
  return { blocks: walked.blocks, sourceDigest: walked.sourceDigest, rows: coverageBlocks(walked.blocks, { extentOf, text }) };
}

/** Two walks that numbered one region at every ordinal. */
function sameRegions(left: readonly Block[], right: readonly Block[]): boolean {
  return left.length === right.length && left.every((block, at) => {
    const other = right[at]!;
    return block.kind === other.kind &&
      block.name === other.name &&
      block.path === other.path &&
      block.owner === other.owner &&
      block.end > block.start === other.end > other.start;
  });
}

/**
 * Rows digested from the lines of `text` they span: a region's own lines, with
 * the lines inside each region it owns left to that region.
 */
function digested(rows: readonly CoverageBlock[], text: string): CoverageBlock[] {
  const lines = text.split('\n');
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
