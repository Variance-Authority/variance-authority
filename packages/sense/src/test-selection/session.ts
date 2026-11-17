// compass: variance-authority.reach.crossings
/**
 * A session's V8 coverage read into the record's own function regions.
 *
 * A session is a flow somebody drove by hand or by script — a page under
 * Playwright, a Node process — and exported as V8 wrote it. It is evidence, not
 * a case: nothing here writes a record, and `select` reads none of it.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { digestString } from '../digest.js';
import type { WalkMode } from '../instrument/spliced.js';
import { sourceCut } from './coverage-rows.js';
import type { CoverageBlock, CoverageModule } from './index.js';
import { decode } from './map-segments.js';
import { lineStarts, sourcePath, type TransformSourceMap } from './source-lines.js';

/** One range V8 counted, as its coverage report writes it: offsets in UTF-16 code units, `endOffset` excluded. */
export interface V8Range {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

/** One function of a V8 script report: its own range first, then any block ranges inside it. */
export interface V8Function {
  readonly functionName: string;
  readonly ranges: readonly V8Range[];
  readonly isBlockCoverage?: boolean;
}

/** A map as a script's build wrote it, with the texts of its sources when it carries them. */
export interface SessionMap extends TransformSourceMap {
  readonly sourcesContent?: readonly (string | null)[];
}

/** One script a session ran: the text V8 counted, its functions, and its map when it has one. */
export interface SessionScript {
  /** The script as a file on this machine; with no map it is the source. */
  readonly file: string;
  readonly text: string;
  readonly functions: readonly V8Function[];
  readonly map?: SessionMap;
  /** The file the map was read from, which its sources resolve against; the script's own file when absent, as for a map inline in it. */
  readonly mapFile?: string;
  /** When the script was built, in milliseconds since the epoch: a source the map holds no text of and that was written since is not read. */
  readonly builtAt?: number;
}

/** A source's text as read from this machine, and when it was last written. */
export interface SourceRead {
  readonly text: string;
  readonly modifiedAt?: number;
}

/** `ran` when any of a function's own code ran, `unrun` when all of it read zero, `unknown` when none of it was observed. */
export type SessionState = 'ran' | 'unrun' | 'unknown';

export interface SessionFunction {
  /** The function region as the record cuts it from {@link SessionSource.text}. */
  readonly row: CoverageBlock;
  readonly state: SessionState;
}

/** One source a session's scripts mapped to, in the text the session ran. */
export interface SessionSource {
  /** Absolute. */
  readonly file: string;
  readonly text: string;
  readonly sourceDigest: string;
  readonly functions: readonly SessionFunction[];
}

export interface SessionRead {
  /** By file, then by digest when one file ran in two texts. */
  readonly sources: readonly SessionSource[];
  /** Sources a map names that no file on this machine answers, or whose text neither the map nor the file gives. */
  readonly unplaced: readonly string[];
  /** Sources placed and read whose text the walk could not cut. */
  readonly uncut: readonly string[];
  /** Sources the map holds no text of, written since the script was built: the text that ran is gone, and none of it is read. */
  readonly stale: readonly string[];
}

/** One session, named, with its sources' files spelled as the record spells them: relative to the checkout. */
export interface NamedSession {
  readonly name: string;
  readonly sources: readonly SessionSource[];
}

/**
 * What one session says of one function of the checkout: a {@link SessionState}
 * when it ran the function in the checkout's text, `other text` when it ran the
 * file in a text where this function reads otherwise, and `not loaded` when it
 * mapped nothing to the file.
 */
export type SessionVerdict = SessionState | 'other text' | 'not loaded';

export interface SessionsFunction {
  /** The function region as the record cuts it from the checkout's text. */
  readonly row: CoverageBlock;
  readonly name: string;
  /** One verdict per session, in the order the sessions were given. */
  readonly sessions: readonly SessionVerdict[];
  /**
   * The test files any suite's record entered this function from, `[]` when no
   * record holds it, and absent when a record holds it in another text: no case
   * can be counted for a function whose recorded text is not the checkout's.
   */
  readonly testFiles?: readonly string[];
}

/** One file any session loaded, with every function the checkout's text cuts it into. */
export interface SessionsFile {
  readonly file: string;
  readonly functions: readonly SessionsFunction[];
}

export interface SessionsAgainst {
  /** The files any session loaded, by file. */
  readonly files: readonly SessionsFile[];
  /** Files a record holds that no session loaded: not loaded, never unrun. */
  readonly notLoaded: readonly string[];
  /** Files a session loaded whose text the walk could not cut: no function of them can be named. */
  readonly uncut: readonly string[];
}

/**
 * Sets each session beside the record, function by function, in the
 * checkout's text: `readFile` gives a file's text on disk, which is what a
 * function is named in; a file the checkout lacks is named in the text the
 * first session that loaded it ran. A function is the same function in a
 * session or a record when its kind, name, path and digest agree; a function whose
 * digest no region of its kind, name and path shares reads as another text,
 * never as ran or unrun. `suites` are
 * the records' modules, one list per suite, cut under `mode`.
 */
export function sessionsAgainst(
  sessions: readonly NamedSession[],
  suites: readonly (readonly CoverageModule[])[],
  readFile: (file: string) => string | undefined,
  mode: WalkMode,
): SessionsAgainst {
  const loaded = new Map<string, SessionSource[][]>();
  sessions.forEach((session, index) => {
    for (const source of session.sources) {
      const each = loaded.get(source.file) ?? sessions.map(() => []);
      each[index]!.push(source);
      loaded.set(source.file, each);
    }
  });
  const recorded = new Map<string, CoverageModule[]>();
  for (const module of suites.flat()) recorded.set(module.file, [...(recorded.get(module.file) ?? []), module]);

  const files: SessionsFile[] = [];
  const uncut: string[] = [];
  for (const [file, perSession] of [...loaded].sort(([a], [b]) => codeUnitOrder(a, b))) {
    const text = readFile(file) ?? perSession.flat()[0]!.text;
    const cut = sourceCut(text, file, mode);
    if (cut === undefined) {
      uncut.push(file);
      continue;
    }
    const verdicts = perSession.map((ran) => {
      const states = new Map<string, SessionState>();
      for (const { row, state } of ran.flatMap((source) => source.functions)) {
        const key = keyOf(row);
        if (RANK[state] > RANK[states.get(key) ?? 'unknown'] || !states.has(key)) states.set(key, state);
      }
      return states;
    });
    const records = (recorded.get(file) ?? []).flatMap((module) => module.blocks);
    const functions = cut.rows.filter((row) => row.kind === 'function').map((row): SessionsFunction => {
      const sessionsSay = verdicts.map((states, index): SessionVerdict => {
        if (perSession[index]!.length === 0) return 'not loaded';
        return states.get(keyOf(row)) ?? 'other text';
      });
      // Siblings may share a kind, name and path, and their own text tells them apart.
      const held = records.filter((block) => sameRegion(block, row));
      const same = held.filter((block) => block.digest === row.digest);
      const testFiles = held.length === 0 ? [] : same.length === 0 ? undefined : [...new Set(same.flatMap((block) => block.testFiles))].sort();
      return { row, name: row.name, sessions: sessionsSay, ...(testFiles === undefined ? {} : { testFiles }) };
    });
    files.push({ file, functions });
  }
  const notLoaded = [...recorded.keys()].filter((file) => !loaded.has(file)).sort();
  return { files, notLoaded, uncut };
}

/** Two texts of one file ran in one session: what either saw of a function stands, and a run over all. */
const RANK: Readonly<Record<SessionState, number>> = { unknown: 0, unrun: 1, ran: 2 };

/** A function's identity in its file: what it is, where it sits, and its own text. */
function keyOf(row: CoverageBlock): string {
  return `${row.kind}\0${row.name}\0${row.path}\0${row.digest}`;
}

function sameRegion(a: CoverageBlock, b: CoverageBlock): boolean {
  return a.kind === b.kind && a.name === b.name && a.path === b.path;
}

/** One observation: a source offset and the count at the generated offset it was mapped from. */
interface Observed {
  readonly at: number;
  readonly count: number;
}

/**
 * Every source the scripts map to, cut under `mode` as the record is, with each
 * function's state; `readSource` gives a text the map lacks, read only when it
 * was written no later than the script was built. The map is walked
 * forward: a segment takes the count of the innermost V8 range around its
 * generated offset and lands in the innermost function around its original one.
 * A function ran when any of its segments ran, is unrun when all read zero, and
 * is unknown when none landed in it. A script with no map is its own source.
 */
export function sessionSources(
  scripts: readonly SessionScript[],
  mode: WalkMode,
  readSource: (file: string) => SourceRead | undefined = () => undefined,
): SessionRead {
  const observed = new Map<string, { readonly file: string; readonly text: string; readonly at: Observed[] }>();
  const unplaced = new Set<string>();
  const stale = new Set<string>();

  for (const script of scripts) {
    const ranges = sortedRanges(script.functions);
    if (script.map === undefined) {
      const text = script.text;
      const slot = held(observed, script.file, text);
      const cut = sourceCut(text, script.file, mode);
      const starts = (cut?.blocks ?? []).filter((block) => block.kind === 'function').map((block) => block.start).sort((a, b) => a - b);
      slot.at.push(...countsAt(ranges, starts).map((count, index) => ({ at: starts[index]!, count })).filter(hasCount));
      continue;
    }
    const map = script.map;
    const files = map.sources.map((source, index) => {
      if (source === null) return undefined;
      const file = sourcePath(map, script.mapFile ?? script.file, source);
      const kept = map.sourcesContent?.[index];
      const read = file === undefined || (kept !== undefined && kept !== null) ? undefined : readSource(file);
      if (file !== undefined && read?.modifiedAt !== undefined && script.builtAt !== undefined && read.modifiedAt > script.builtAt) {
        stale.add(file);
        return undefined;
      }
      const text = kept ?? read?.text;
      if (file === undefined || text === undefined || text === null) {
        unplaced.add(source);
        return undefined;
      }
      return { slot: held(observed, file, text), starts: lineStarts(text) };
    });
    const generated = lineStarts(script.text);
    const segments = decode(map.mappings).flatMap((line, at) => line.map((segment) => ({ segment, offset: (generated[at] ?? Infinity) + segment.column })));
    const counts = countsAt(ranges, segments.map((each) => each.offset));
    segments.forEach(({ segment }, index) => {
      const count = counts[index];
      const source = files[segment.source];
      if (count === undefined || source === undefined) return;
      source.slot.at.push({ at: (source.starts[segment.line] ?? Infinity) + segment.original, count });
    });
  }

  const sources: SessionSource[] = [];
  const uncut: string[] = [];
  for (const { file, text, at } of observed.values()) {
    const cut = sourceCut(text, file, mode);
    if (cut === undefined) {
      uncut.push(file);
      continue;
    }
    const states = regionStates(cut.blocks, at);
    const functions = cut.blocks.flatMap((block, index) =>
      block.kind === 'function' ? [{ row: cut.rows[index]!, state: states.get(block.ordinal) ?? 'unknown' }] : []);
    sources.push({ file, text, sourceDigest: cut.sourceDigest, functions });
  }
  sources.sort((a, b) => codeUnitOrder(a.file, b.file) || codeUnitOrder(a.sourceDigest, b.sourceDigest));
  return { sources, unplaced: [...unplaced].sort(), uncut: uncut.sort(), stale: [...stale].sort() };
}

function hasCount(observed: { readonly count: number | undefined }): observed is Observed {
  return observed.count !== undefined;
}

/** The observations of one text of `file`, shared by every script that ran that text. */
function held(
  observed: Map<string, { readonly file: string; readonly text: string; readonly at: Observed[] }>,
  file: string,
  text: string,
): { readonly at: Observed[] } {
  const key = `${file}\0${digestString(text)}`;
  let slot = observed.get(key);
  if (slot === undefined) {
    slot = { file, text, at: [] };
    observed.set(key, slot);
  }
  return slot;
}

/** Every range of every function, outer before inner: by start, the longer first. */
function sortedRanges(functions: readonly V8Function[]): readonly V8Range[] {
  return functions
    .flatMap((each) => each.ranges)
    .slice()
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
}

/**
 * The count of the innermost range around each offset, or `undefined` where
 * none is. V8's ranges nest, so one sweep with a stack of the open ones answers
 * every offset: a range opens when the sweep reaches its start and closes when
 * it passes its end.
 */
function countsAt(ranges: readonly V8Range[], offsets: readonly number[]): (number | undefined)[] {
  const order = offsets.map((_, index) => index).sort((a, b) => offsets[a]! - offsets[b]!);
  const answers: (number | undefined)[] = Array.from({ length: offsets.length }, () => undefined);
  const open: V8Range[] = [];
  let next = 0;
  for (const index of order) {
    const offset = offsets[index]!;
    while (next < ranges.length && ranges[next]!.startOffset <= offset) {
      const range = ranges[next]!;
      while (open.length > 0 && open[open.length - 1]!.endOffset <= range.startOffset) open.pop();
      open.push(range);
      next += 1;
    }
    while (open.length > 0 && open[open.length - 1]!.endOffset <= offset) open.pop();
    answers[index] = open[open.length - 1]?.count;
  }
  return answers;
}

/**
 * Each function region's state from the observations in its own code: those
 * that fall in it and in no function inside it. The module's top level owns
 * what no function does, and is not a function.
 */
function regionStates(
  blocks: readonly { readonly ordinal: number; readonly kind: string; readonly start: number; readonly end: number }[],
  observed: readonly Observed[],
): Map<number, SessionState> {
  const regions = blocks
    .filter((block) => block.kind === 'function' || block.kind === 'module')
    .slice()
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const at = observed.slice().sort((a, b) => a.at - b.at);
  const states = new Map<number, SessionState>();
  const open: (typeof regions)[number][] = [];
  let next = 0;
  for (const { at: offset, count } of at) {
    while (next < regions.length && regions[next]!.start <= offset) {
      const region = regions[next]!;
      while (open.length > 0 && open[open.length - 1]!.end <= region.start) open.pop();
      open.push(region);
      next += 1;
    }
    while (open.length > 0 && open[open.length - 1]!.end <= offset) open.pop();
    const region = open[open.length - 1];
    if (region === undefined || region.kind !== 'function') continue;
    if (count > 0) states.set(region.ordinal, 'ran');
    else if (states.get(region.ordinal) !== 'ran') states.set(region.ordinal, 'unrun');
  }
  return states;
}
