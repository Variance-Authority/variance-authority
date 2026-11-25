/**
 * A story on disk: the regions one case visited, in the order it visited them.
 *
 * Nothing selects on one or folds it into a record: it is read back only to be
 * drawn or compared. {@link decodeStory} says what its bytes are.
 *
 * CommonJS so the collectors can require it from inside a runner's sandbox,
 * for the reason `journal-format.cts` is.
 */

import type crypto = require('node:crypto');
import type fs = require('node:fs');
import type path = require('node:path');
import caseOwner = require('../test-selection/case-owner.cjs');
import storyBytes = require('./story-bytes.cjs');
import type { ModuleId } from '../instrument/index.js';
import type storyTap = require('../instrument/story-tap.cjs');

// Builtins are required where a file is named, read or written: a live head
// only encodes, and an ES module bundle of it can require no builtin.
const builtins = (): { crypto: typeof crypto; fs: typeof fs; path: typeof path } => ({
  crypto: require('node:crypto'), fs: require('node:fs'), path: require('node:path'),
});

type Tape = ReturnType<ReturnType<typeof storyTap.createTap>['read']>;

const { MAGIC, EVALUATING, rowAt } = storyBytes;

/** A story read back. */
interface Story {
  /** The test file, as the runner named it. */
  readonly file: string;
  /** The case, as the runner named it: `describe > case`. */
  readonly name: string;
  /** `[module, block count]` for every module a visit names, in first-visit order. */
  readonly rows: readonly (readonly [ModuleId, number])[];
  /**
   * What ran outside any case just before this one began: the last case's
   * `afterEach` and this one's `beforeEach`, whichever the runner ran outside
   * the case's bracket. A reader never labels them as the case.
   */
  readonly before: Int32Array;
  /** What ran in the case, in order. */
  readonly visits: Int32Array;
  /**
   * Visits made after the tape stopped, in this case or another since the tape
   * last started. Zero is a tape that kept everything.
   */
  readonly untaped: number;
  /**
   * How many times another case's work ran in the middle of this one's. Only
   * a run that follows cases through the async context can see it; elsewhere it
   * is zero because one case runs at a time.
   */
  readonly interleaved: number;
  /** Whether the case's body threw or rejected; absent where the collector could not see it settle. */
  readonly stopped?: boolean;
  /** What was said during the case: how many of its visits came before each line, and the line. */
  readonly notes: readonly (readonly [at: number, text: string])[];
  /** What was said before the case began, the same way over `before`. */
  readonly beforeNotes: readonly (readonly [at: number, text: string])[];
  /** Lines the tape did not keep. */
  readonly unnoted: number;
  /** Each test line a statement of the case ran at, placed as {@link notes} are; `1` marks a hook's. */
  readonly lines: readonly TestLine[];
  /** Each test line run before the case began, placed as {@link beforeNotes} are. */
  readonly beforeLines: readonly TestLine[];
  /** The project the case ran under, where its runner runs one file in several: `chromium`, `firefox`. */
  readonly project?: string;
  /**
   * Whether a page the case ran in was gone before what it ran there was read,
   * so the story is missing it; absent where the writer could not tell.
   */
  readonly lost?: boolean;
  /**
   * Where the case's story moves from one realm to another, for a case that
   * ran in pages: each part placed as {@link lines} are, with the frame it ran
   * in, numbered from 1 in the order the case met them, and the document in
   * it, numbered across the case. Frame and document 0 is the runner's own
   * process. Absent where the case ran in one realm.
   */
  readonly parts?: readonly Part[];
}

/** Where a case's story moves into another realm: after `at` visits and `said` notes, frame `frame`'s document `document`. */
type Part = readonly [at: number, said: number, frame: number, document: number];

/**
 * Where a test line's statement ran, the line, how many of its part's notes
 * were said before it — a line and a note at one visit keep the order they came
 * in — and `1` where it is a hook's. A line is where the case was, not
 * something it said, so it is never a note.
 */
type TestLine = readonly [at: number, line: number, said: number, hook?: 1];

/**
 * How many readings of one case a directory keeps; writing another removes the
 * oldest. Two sets of readings say which differences come back every time and
 * which move between runs.
 */
const READINGS = 16;

/** The one case a story is of, as the start of every reading's file name. */
function caseStem(file: string, name: string, project?: string): string {
  const named = project === undefined ? `${file}\u0000${name}` : `${file}\u0000${name}\u0000${project}`;
  const { crypto } = builtins();
  return crypto.createHash('sha256').update(named).digest('hex').slice(0, 32);
}

/**
 * What a reading's file name, `<stem>.<written>-<pid>-<n>[.<label>].story`,
 * says: its case, when it was written, and the label it was given.
 */
interface ReadingName {
  readonly stem: string;
  /** Milliseconds since the epoch; absent on a story written before readings were kept. */
  readonly written?: number;
  readonly label?: string;
}

/** A reading's file name read back, or `undefined` for a name no writer gives. */
function readingOf(fileName: string): ReadingName | undefined {
  const parts = fileName.split('.');
  if (parts.at(-1) !== 'story' || !/^[0-9a-f]{32}$/u.test(parts[0]!)) return undefined;
  if (parts.length === 2) return { stem: parts[0]! };
  const written = Number(parts[1]!.split('-')[0]);
  if (!Number.isFinite(written) || parts.length > 4) return undefined;
  return { stem: parts[0]!, written, ...(parts.length === 4 ? { label: parts[2]! } : {}) };
}

/**
 * The label a run asked for, from `VARIANCE_AUTHORITY_STORY`: any value but `1`,
 * spelled so it survives a file name. `1`, or a value with no letter or digit
 * in it, gives no label.
 */
function labelOf(asked: string | undefined): string | undefined {
  if (asked === undefined || asked === '1') return undefined;
  const label = asked.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40);
  return label === '' ? undefined : label;
}

/**
 * The story of the case keyed `key` on `tape`.
 *
 * A case that visited no instrumented region still has a story, and it is an
 * empty one: the case ran under the flag and reached nothing the run records.
 * Writing nothing would read the same as a run without the flag. What came
 * before such a case is not told, because a case with no visit has no place on
 * the tape to begin.
 */
function encodeStory(tape: Tape, key: string, stopped?: boolean, page: Parameters<typeof storyBytes.storyBytes>[5] = {}): Buffer {
  const bytes = storyBytes.storyBytes(tape, key, caseOwner.unpackCase(key), (text) => Buffer.from(text, 'utf8'), stopped, page);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * A story's bytes read back, or an error naming what they are not: the magic,
 * a `u32` length and that much JSON padded to 4, then an `i32` a visit, those
 * before the case first.
 * A visit is an index in the story's own row table, as the realm's are the
 * order its modules registered in, with the evaluating bit as its sign bit.
 */
function decodeStory(bytes: Uint8Array): Story {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = (): Error => new Error('variance-authority: this is not a story this build writes');
  if (buffer.length < MAGIC.length + 4) throw damaged();
  for (let at = 0; at < MAGIC.length; at += 1) if (buffer[at] !== MAGIC[at]) throw damaged();
  const length = buffer.readUInt32LE(MAGIC.length);
  const body = MAGIC.length + 4 + ((length + 3) & ~3);
  if (body > buffer.length || (buffer.length - body) % 4 !== 0) throw damaged();
  const header = JSON.parse(buffer.toString('utf8', MAGIC.length + 4, MAGIC.length + 4 + length)) as Omit<
    Story,
    'before' | 'visits' | 'notes' | 'beforeNotes' | 'unnoted' | 'lines' | 'beforeLines'
  > & { before: number } & Partial<Pick<Story, 'notes' | 'beforeNotes' | 'unnoted' | 'lines' | 'beforeLines'>>;
  const all = new Int32Array((buffer.length - body) / 4);
  for (let at = 0; at < all.length; at += 1) all[at] = buffer.readInt32LE(body + at * 4);
  return {
    ...header,
    notes: header.notes ?? [],
    beforeNotes: header.beforeNotes ?? [],
    unnoted: header.unnoted ?? 0,
    lines: header.lines ?? [],
    beforeLines: header.beforeLines ?? [],
    before: all.subarray(0, header.before),
    visits: all.subarray(header.before),
  };
}

/**
 * The file, the case and how many visits the case made, read from a story's
 * header and its size without reading the visits. Listing a directory of
 * stories must not cost the sum of them: one hot loop writes tens of megabytes.
 */
function storyHeader(file: string): {
  readonly file: string;
  readonly name: string;
  readonly project?: string;
  readonly visits: number;
  readonly stopped?: boolean;
  readonly lost?: boolean;
} {
  const { fs } = builtins();
  const damaged = (): Error => new Error(`variance-authority: ${file} is not a story this build writes`);
  const descriptor = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    const lead = Buffer.alloc(MAGIC.length + 4);
    if (size < lead.length || fs.readSync(descriptor, lead, 0, lead.length, 0) !== lead.length) throw damaged();
    for (let at = 0; at < MAGIC.length; at += 1) if (lead[at] !== MAGIC[at]) throw damaged();
    const length = lead.readUInt32LE(MAGIC.length);
    const body = lead.length + ((length + 3) & ~3);
    if (body > size || (size - body) % 4 !== 0) throw damaged();
    const text = Buffer.alloc(length);
    if (fs.readSync(descriptor, text, 0, length, lead.length) !== length) throw damaged();
    const header = JSON.parse(text.toString('utf8')) as { file: string; name: string; project?: string; before: number; stopped?: boolean; lost?: boolean };
    return {
      file: header.file,
      name: header.name,
      ...(header.project === undefined ? {} : { project: header.project }),
      visits: (size - body) / 4 - header.before,
      ...(header.stopped === undefined ? {} : { stopped: header.stopped }),
      ...(header.lost === undefined ? {} : { lost: header.lost }),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * What a collector hands a story to: a reading per run of a case in
 * `directory`, the last {@link READINGS} kept.
 *
 * @param label What the run called its readings, as `VARIANCE_AUTHORITY_STORY`
 * says it in the realm the case runs in.
 */
function storyWriter(
  directory: string,
  label: string | undefined = labelOf(process.env.VARIANCE_AUTHORITY_STORY),
): (key: string, bytes: Uint8Array) => void {
  const { fs, path } = builtins();
  let written = 0;
  return (key, bytes) => {
    const { file, name, project } = caseOwner.unpackCase(key);
    const stem = caseStem(file, name, project);
    fs.mkdirSync(directory, { recursive: true });
    written += 1;
    const reading = `${stem}.${Date.now()}-${process.pid}-${written}${label === undefined ? '' : `.${label}`}.story`;
    fs.writeFileSync(path.join(directory, reading), bytes);
    const kept: { name: string; written: number }[] = [];
    for (const each of fs.readdirSync(directory)) {
      const read = readingOf(each);
      if (read?.stem === stem) kept.push({ name: each, written: read.written ?? 0 });
    }
    // FIXME: a copy of core's `codeUnitOrder`, reversed. Jest's sandbox loads
    // this file untransformed, and core's `./segment` has no CommonJS build to
    // require; once it has one, the tie is `codeUnitOrder(right.name, left.name)`.
    kept.sort((left, right) => right.written - left.written || (left.name < right.name ? 1 : -1));
    for (const { name: old } of kept.slice(READINGS)) fs.rmSync(path.join(directory, old), { force: true });
  };
}

export = { caseStem, readingOf, labelOf, storyWriter, encodeStory, decodeStory, storyHeader, rowAt, EVALUATING, READINGS };
