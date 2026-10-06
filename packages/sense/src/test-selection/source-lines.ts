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

interface Segment {
  readonly column: number;
  readonly source: number;
  readonly line: number;
  /**
   * Opens its generated line with the origin the segment before it ended on:
   * the statement above continuing, not something written here.
   */
  readonly carried: boolean;
}

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
  };
}

/**
 * The frame of a module the include accepts, asked about the file the module is
 * recorded under rather than the one the host loaded; `undefined` when it refuses.
 *
 * A workspace library consumed through its manifest arrives as `dist/x.js`, and
 * an include refuses built output; its map leads to `src/x.ts`, which is what
 * the record is named after. So a module refused under its own name is asked
 * about again under the one its map gives — and only then is the map asked for,
 * because a host builds one for every module it is asked about. A module under
 * `node_modules` is not asked again: a dependency's map leads into the
 * dependency. The map is a thunk for that reason.
 */
export function includedFrame(
  code: string,
  map: () => TransformSourceMap | undefined,
  file: string,
  include: (file: string) => boolean,
  original: (path: string) => string,
): RecordedFrame | undefined {
  const own = include(file);
  if (!own && /[/\\]node_modules[/\\]/.test(file)) return undefined;
  const prior = map();
  if (!own && originalFile(prior, file) === undefined) return undefined;
  const frame = recordedFrame(code, prior, file, original);
  // A map whose original cannot be read leaves the frame under the host's name,
  // and that name was answered already.
  return (frame.file === file ? own : include(frame.file)) ? frame : undefined;
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
  return { file, extentOf: () => [1, lines], sourceDigest: digestString(text) };
}

/**
 * The file a map says the text was written in, when it says one and only one.
 *
 * A host hands the transform hook whatever it was asked to load, and for a
 * package consumed as a build that is `dist/thing.js`. Its map points back at
 * `src/thing.ts`, and {@link sourceLines} already follows the pointer — the
 * block extents recorded for such a module are lines of the original, not of
 * the file the name says. Following it for the lines and not for the name
 * leaves a record nothing can join: a graph walk asks the scanner about
 * `dist/thing.js`, the scanner reads imports and has never seen it, and every
 * test that entered the module comes back unplaced.
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

/** Segments per generated line, carrying only the fields a position needs. */
function decode(mappings: string): readonly (readonly Segment[])[] {
  const lines: Segment[][] = [];
  let segments: Segment[] = [];
  let column = 0;
  let source = 0;
  let line = 0;
  let original = 0;
  let previous: { readonly source: number; readonly line: number; readonly original: number } | undefined;
  let index = 0;

  while (index < mappings.length) {
    const char = mappings[index];
    if (char === ';') {
      // Only the line just above can carry an origin onto the next one.
      if (segments.length === 0) previous = undefined;
      lines.push(segments);
      segments = [];
      column = 0;
      index += 1;
      continue;
    }
    if (char === ',') {
      index += 1;
      continue;
    }

    const first = vlq(mappings, index);
    column += first.value;
    index = first.next;
    if (boundary(mappings, index)) {
      // Unmapped code: what follows it carries nothing over.
      previous = undefined;
      continue;
    }

    const second = vlq(mappings, index);
    source += second.value;
    const third = vlq(mappings, second.next);
    line += third.value;
    // The original column. A diff's unit is the line, so it only tells a
    // carried origin from a new one on the same line.
    const fourth = vlq(mappings, third.next);
    original += fourth.value;
    index = fourth.next;
    if (!boundary(mappings, index)) index = vlq(mappings, index).next;

    const carried =
      segments.length === 0 &&
      previous !== undefined &&
      previous.source === source &&
      previous.line === line &&
      previous.original === original;
    previous = { source, line, original };
    segments.push({ column, source, line, carried });
  }

  lines.push(segments);
  return lines;
}

function boundary(mappings: string, index: number): boolean {
  return index >= mappings.length || mappings[index] === ',' || mappings[index] === ';';
}

const DIGITS = new Map<string, number>(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map(
    (character, value) => [character, value],
  ),
);

/** One base64 VLQ field, and where the next one starts. */
function vlq(mappings: string, at: number): { readonly value: number; readonly next: number } {
  let result = 0;
  let shift = 0;
  let index = at;

  for (;;) {
    const digit = DIGITS.get(mappings[index] ?? '');
    if (digit === undefined) return { value: 0, next: index + 1 };
    index += 1;
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }

  const negative = (result & 1) === 1;
  return { value: negative ? -(result >>> 1) : result >>> 1, next: index };
}
