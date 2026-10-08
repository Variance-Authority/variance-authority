/**
 * Where a block was written, as against where the bundler put it.
 *
 * Probes are spliced into whatever the bundler hands the plugin, and by then a
 * `.tsx` module has been through a JSX transform: blank lines dropped, elements
 * expanded over several lines each, a `keepNames` prologue on top. Sixty-one
 * lines of source arrive as a hundred and eighteen, and none of them are where
 * they started.
 *
 * The extents recorded beside each block have exactly one reader — a diff — and
 * a diff speaks in the coordinates of the file the author edited. Recorded from
 * the transformed text they are not approximately right, they are a different
 * number line, and the selector answers with whichever regions happen to sit at
 * those offsets after the transform. That failure is silent and it is not even
 * consistently wrong, which is the worst shape a wrong answer has.
 *
 * So the extents are translated back through the map the bundler already keeps.
 * Nothing here is a source map implementation: it decodes the one field that
 * carries positions and answers one question — *which lines of the original was
 * this region written on*. With no map there is nothing to translate through,
 * and the answer is the generated lines, in the text the record's digest is
 * then taken of. With a map, a region nothing of which has an origin is
 * answered with no lines at all: it is text the transform wrote, and the
 * generated line it sits on is a place in a file the diff is not written
 * against.
 */

import { dirname, resolve } from 'node:path';
import { digestString } from '../digest.js';
import { decode, type Segment } from './map-segments.js';

/** The fields of a bundler's map this reads. */
export interface TransformSourceMap {
  readonly mappings: string;
  readonly sources: readonly (string | null)[];
  /** Prefixed to every relative entry in `sources`, when the producer set one. */
  readonly sourceRoot?: string;
}

/**
 * A region of the transformed text — the offsets of its first and last
 * characters — answered as the lines of the original those two were written on,
 * in that order. `undefined` when the region was not written in the original.
 */
export type ExtentOf = (start: number, last: number) => readonly [number, number] | undefined;

/**
 * A lookup from transformed offsets to original lines.
 *
 * `file` narrows a map that names more than one source — a bundler that inlined
 * a helper alongside the module still reports one file's mappings among
 * another's, and a segment from the helper would place a block in a file the
 * diff will never name. When no source matches, every segment is accepted: a map
 * whose paths are written relative to a root this cannot see is still that
 * module's map, and the alternative is discarding it whole.
 *
 * Each end is the origin of the last thing at or before it, so the only text
 * with no answer is text before the first origin in the module — the prologue
 * esbuild writes when it lowers a decorator, forty-odd lines of helpers above
 * the first line anyone wrote. A region that ends there has no lines. One that
 * only begins there — the module itself — was written from its first origin
 * on, so its first line is the origin of the first thing after its start; that
 * origin sits inside the region, because its end has one and its start does
 * not.
 *
 * The last thing before a start is not always something written before it.
 * esbuild opens a generated line that continues a statement with that
 * statement's origin repeated, so the `else` of an `if` on the line above
 * carries the `if`'s line, and the nested `if` after it has no segment of its
 * own. A region opening there answers with the line above, strictly contains
 * the regions on its own line, and a line query drops it as the outer one. So
 * when what precedes a start on its own generated line is such a carried
 * origin, the start is the origin of the first thing written in the region on
 * that line.
 */
export function sourceLines(
  code: string,
  map: TransformSourceMap | undefined,
  file: string,
): ExtentOf {
  // Once per module, not once per offset. A block asks twice and a module has
  // thousands of them, so counting newlines from the top each time is quadratic
  // in the file: over zod's source it is 268 ms, a quarter of everything the
  // process transforming that suite does.
  const starts = lineStarts(code);
  if (map === undefined || map.mappings === '') {
    return (start, last) => [lineOfStart(starts, start) + 1, lineOfStart(starts, last) + 1];
  }

  const only = sourceIndex(map.sources, file);
  const lines = decode(map.mappings);
  const at = (offset: number): readonly [number, number] => {
    const line = lineOfStart(starts, offset);
    return [line, offset - (starts[line] ?? 0)];
  };

  return (start, last) => {
    const closes = nearest(lines, ...at(last), only);
    if (closes === undefined) return undefined;
    const opens =
      opening(lines, at(start), at(last), only) ??
      nearest(lines, ...at(start), only) ??
      following(lines, ...at(start), only) ??
      closes;
    return [opens + 1, closes + 1];
  };
}

/**
 * A module's block extents and the digest of the text they are extents in.
 *
 * One value because they are one claim. A record carries a digest beside block
 * lines, and the only thing a reader can do with the lines is compare them
 * against a text it fetched by that digest — `recorded()` in `select.ts` does
 * exactly that, and a run's whole skip list rests on the answer. A digest is
 * evidence about a *text*, never about which text a line was counted in, so a
 * seam that takes the digest from the file on disk and the lines from
 * {@link sourceLines} has written two claims about two different number lines
 * and nothing downstream can tell. The fallback above is where they part: it
 * answers in the transformed text's own lines whenever there is no map to read
 * back through, which is what Rollup leaves behind the moment any upstream
 * plugin returns `{ code, map: null }`.
 *
 * So the digest follows the lines rather than the file: the original's when the
 * extents were translated into it, and the transformed text's own when they
 * were not. A build that moved nothing hashes the same either way and narrows
 * as it always did. A build that moved something no longer matches the text at
 * its own commit, which is the snapshot reporting itself stale — every region
 * charged, the tests kept, and the module named in `ExecutionNarrowing.stale`
 * where a reader can see which build has no map to give.
 *
 * A transform that leaves no text is not that case. A module of nothing but
 * types arrives empty, with a map whose mappings are empty because there is no
 * position to give an origin to — the map is exact, not missing. Digesting the
 * empty text records a module no commit ever held, and every change to the file
 * is then read as a stale frame: every loader charged over an edit to a comment.
 * An empty text has no line a block could be counted in, so the frame is the
 * file itself, and the one region such a module has — loading it — spans all of
 * it.
 *
 * `original` is called with the file the lines landed in, which is usually the
 * one the host named and is {@link originalFile} when the map points somewhere
 * else. It is called only when there is a map worth reading back through or no
 * text to read, and a seam whose id is not a file on disk may throw rather than
 * answer. That is the untranslatable case again and it is recorded the same way,
 * under the host's name: a frame reports one file or none, never a name from one
 * text and a digest from another.
 */
export interface RecordedFrame {
  /** A region of the transformed text, as lines of the digested text. */
  readonly extentOf: ExtentOf;
  /** Of the text {@link extentOf} answers in, which is what a record must carry. */
  readonly sourceDigest: string;
  /** The file that text is, which is what a record must be named after. */
  readonly file: string;
  /** The text {@link sourceDigest} is of, which a region's digest is cut from. */
  readonly text: string;
}

export function recordedFrame(
  code: string,
  map: TransformSourceMap | undefined,
  file: string,
  original: (path: string) => string,
): RecordedFrame {
  const translated = map !== undefined && map.mappings !== '';
  if (!translated && code.trim() === '') {
    const whole = wholeFile(file, original);
    if (whole !== undefined) return whole;
  }
  const candidate = originalFile(map, file) ?? file;
  let text: string | undefined;
  let named = file;
  if (translated) {
    try {
      text = original(candidate);
      named = candidate;
    } catch {
      text = undefined;
    }
  }

  return {
    file: named,
    extentOf: sourceLines(code, map, file),
    sourceDigest: digestString(text ?? code),
    text: text ?? code,
  };
}

/**
 * The frame of a module read as it is on disk, before any transform: named
 * after the file, digested as the text, its lines the text's own.
 *
 * Except for a workspace library consumed as its build. `tsc` writes
 * `dist/thing.js` ending in `//# sourceMappingURL=thing.js.map`, and that map
 * names `src/thing.ts`, the file a diff is written against. When the file ends
 * in such a comment, the text handed over is that file, the sibling map names
 * exactly one source outside `node_modules`, and `include` accepts it, the
 * frame is that source's: its name, its digest, and lines read back through
 * the map. Anything else — an inline map, a bundle's many sources, a map or
 * source that cannot be read — is the file under its own name, and so is a
 * source `include` refuses: a module accepted under its own name is never
 * dropped because of where its map points.
 *
 * Under its own name it is still the file, not the text handed over. A map
 * with no positions in it — `tsc`'s for a module of nothing but types, which
 * builds to `export {};` — leaves the build recorded under its own name, and a
 * dev server hands that build over with its comment blanked. Digested as
 * handed, the record names a text no commit holds: every landing of a run that
 * did not load the module reads the file on disk as moved, cuts it again, and
 * demotes every test that loaded it, and the next run of those tests records
 * the blanked text again. Blanking keeps every offset and every line, so the
 * frame is the file's: its digest, and regions cut from it.
 *
 * A file on disk that is not the text handed over, as it is or blanked, was
 * changed by something that ran first, and nothing relates the two texts'
 * lines. The frame is still cut from the text handed over, as before, and says
 * so with {@link RawFrame.changed}: what a caller does about it is the caller's.
 *
 * `undefined` when neither name is accepted.
 */
export function rawFrame(
  code: string,
  file: string,
  include: (file: string) => boolean,
  original: (path: string) => string,
): RawFrame | undefined {
  const read = onDisk(file, original);
  const disk = read !== undefined && handedTexts(read).includes(code) ? read : undefined;
  const map = disk === undefined ? undefined : builtMap(disk, file, original);
  const source = map === undefined ? undefined : originalFile(map, file);
  if (source !== undefined && !NODE_MODULES.test(source) && include(source)) {
    const frame = recordedFrame(code, map, file, original);
    if (frame.file === source) return frame;
  }
  if (!include(file)) return undefined;
  const frame = recordedFrame(code, undefined, file, original);
  if (disk === undefined) return read === undefined ? frame : { ...frame, changed: true };
  return frame.text !== code ? frame : { ...frame, sourceDigest: digestString(disk), text: disk };
}

/** A {@link RecordedFrame} as {@link rawFrame} cuts it. */
export interface RawFrame extends RecordedFrame {
  /** The file is on disk, and the text handed over is not it: something changed it first. */
  readonly changed?: true;
}

/** A sibling's name only: a `data:` map or a path elsewhere has a `/` in it. */
const SOURCE_MAPPING_URL = /\/\/[#@] sourceMappingURL=([^\s'"/\\]+)(?=\s*$)/;
const NODE_MODULES = /[/\\]node_modules[/\\]/;

/**
 * The file on disk, outside `node_modules`. {@link rawFrame} takes it as the
 * text handed over when that is the file as it is, or with the comment blanked
 * in place, which is what a Vite dev server hands a plugin once it has read the
 * map itself.
 */
function onDisk(file: string, original: (path: string) => string): string | undefined {
  if (NODE_MODULES.test(file)) return undefined;
  try {
    return original(file);
  } catch {
    return undefined;
  }
}

/** The map the file on disk points at. */
function builtMap(disk: string, file: string, original: (path: string) => string): TransformSourceMap | undefined {
  try {
    const pointer = SOURCE_MAPPING_URL.exec(disk);
    if (pointer === null) return undefined;
    const map = JSON.parse(original(resolve(dirname(file), pointer[1]!))) as Partial<TransformSourceMap> | null;
    return typeof map?.mappings === 'string' && Array.isArray(map.sources) ? map as TransformSourceMap : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The texts a host hands a transform for a file whose contents are `disk`: the
 * file as it is, and, when it ends in a `sourceMappingURL` comment, the file
 * with that comment blanked in place, which is what a Vite dev server hands a
 * plugin once it has read the map itself.
 */
export function handedTexts(disk: string): readonly string[] {
  const pointer = SOURCE_MAPPING_URL.exec(disk);
  if (pointer === null) return [disk];
  const end = pointer.index + pointer[0].length;
  return [disk, `${disk.slice(0, pointer.index)}${' '.repeat(pointer[0].length)}${disk.slice(end)}`];
}

/** The frame of a module whose transformed text is empty: the file, every line of it. */
function wholeFile(file: string, original: (path: string) => string): RecordedFrame | undefined {
  let text: string;
  try {
    text = original(file);
  } catch {
    return undefined;
  }
  const starts = lineStarts(text);
  // A newline ends the line it is on; it does not open one nothing is written on.
  const lines = Math.max(1, text.endsWith('\n') ? starts.length - 1 : starts.length);
  return { file, extentOf: () => [1, lines], sourceDigest: digestString(text), text };
}

/**
 * The file a map says the text was written in, when it says one and only one.
 *
 * For a package consumed as a build the host names `dist/thing.js`, and its
 * map leads {@link sourceLines} to lines of `src/thing.ts`. Following it for
 * the lines and not for the name leaves a record nothing can join: the scanner
 * reads imports, has never seen `dist/thing.js`, and every test that entered
 * the module comes back unplaced.
 *
 * So the name follows the lines, for the reason the digest does. The map is
 * read the same way here as there and answers only where it is unambiguous:
 * exactly one named source, resolved against the map's own directory. A bundle
 * chunk carries many, one per module the bundler folded in, and there is no
 * single file to rename it to — naming it after the first would trade a name
 * nothing can join for a name that joins to the wrong thing. Those keep the
 * name the host gave them until blocks are cut per `sources` entry.
 *
 * `undefined` also when the map names this file already, which is the ordinary
 * case: a TypeScript or JSX transform emits a map whose one source is the
 * module itself, and there is nothing to follow.
 */
function originalFile(map: TransformSourceMap | undefined, file: string): string | undefined {
  if (map === undefined || map.mappings === '') return undefined;
  if (sourceIndex(map.sources, file) !== undefined) return undefined;

  const named = map.sources.filter((source): source is string => source !== null && source !== '');
  const only = named.length === 1 ? named[0] : undefined;
  // A virtual module's id is not a path, and an absolute URL is not this
  // machine's. Both are names a reader cannot open, which is what the host's
  // own name at least is.
  if (only === undefined || only.startsWith('\0') || only.includes('://')) return undefined;

  const root = map.sourceRoot ?? '';
  return resolve(dirname(file), root === '' ? only : `${root.replace(/\/$/, '')}/${only}`);
}

/**
 * The segment covering a position, or the last one before it.
 *
 * A transformed line with no segments of its own is code the bundler emitted
 * without an origin — a helper prologue, a hoisted import — and the honest
 * answer for it is the origin of the last thing that had one, walking back
 * rather than reporting the top of the file.
 */
function nearest(
  lines: readonly (readonly Segment[])[],
  line: number,
  column: number,
  only: number | undefined,
): number | undefined {
  for (let at = Math.min(line, lines.length - 1); at >= 0; at -= 1) {
    const segments = lines[at];
    if (segments === undefined) continue;
    let best: Segment | undefined;
    for (const segment of segments) {
      if (only !== undefined && segment.source !== only) continue;
      // Past the position on its own line. Earlier lines are read to their end,
      // because what is wanted there is the last origin before the position.
      if (at === line && segment.column > column) break;
      best = segment;
    }
    if (best !== undefined) return best.line;
  }
  return undefined;
}

/**
 * The first origin written inside a region on the line it opens, when the only
 * origin before its start there is one carried over from the line above.
 * `undefined` otherwise, and the start is then {@link nearest}'s.
 */
function opening(
  lines: readonly (readonly Segment[])[],
  [line, column]: readonly [number, number],
  [lastLine, lastColumn]: readonly [number, number],
  only: number | undefined,
): number | undefined {
  let before: Segment | undefined;
  for (const segment of lines[line] ?? []) {
    if (only !== undefined && segment.source !== only) continue;
    if (segment.column === column) return undefined;
    if (segment.column < column) {
      before = segment;
      continue;
    }
    if (before?.carried !== true) return undefined;
    if (line === lastLine && segment.column > lastColumn) return undefined;
    return segment.line;
  }
  return undefined;
}

/**
 * The first segment at or after a position, for a position that has none
 * before it. Only the prologue asks, so the walk ends at the first line of
 * origins it meets.
 */
function following(
  lines: readonly (readonly Segment[])[],
  line: number,
  column: number,
  only: number | undefined,
): number | undefined {
  for (let at = line; at < lines.length; at += 1) {
    for (const segment of lines[at] ?? []) {
      if (only !== undefined && segment.source !== only) continue;
      if (at === line && segment.column < column) continue;
      return segment.line;
    }
  }
  return undefined;
}

function sourceIndex(sources: readonly (string | null)[], file: string): number | undefined {
  const found = sources.findIndex((source) => source !== null && names(file, source));
  return found === -1 ? undefined : found;
}

function names(file: string, source: string): boolean {
  const tail = source.replace(/^(?:\.\.?\/)+/, '');
  return file === source || file.endsWith(`/${tail}`);
}

/** Which line an offset falls on, zero-based, by bisecting the line starts. */
function lineOfStart(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function lineStarts(code: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}
