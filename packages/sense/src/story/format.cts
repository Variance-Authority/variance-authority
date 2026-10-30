/**
 * A story on disk: the regions one case visited, in the order it visited them.
 *
 * A journey is the set of places a case reached, and it is what every other
 * part of the recording is built from. A story is the tape
 * [`story-tap.cts`](../instrument/story-tap.cts) keeps beside it when somebody
 * runs with `VARIANCE_AUTHORITY_STORY=1`, cut to one case. Nothing selects on
 * it or folds it into a record: it is written for the person or agent reading
 * one case, and it is read back only by `variance story`, which draws one
 * reading or compares two sets of them.
 *
 * ## Layout
 *
 * ```
 * magic      VASTRY\0\1                     8 bytes
 * header     u32 length, then UTF-8 JSON    padded to 4
 * visits     i32 each                       before, then the case
 * ```
 *
 * The header says which file and case the story is, the rows it uses as
 * `[module, block count]`, how many of the visits came before the case, and
 * what the tape could not keep. A visit is a region's index in the story's own
 * row table — the realm's indices are the order modules happened to register
 * in, which means nothing outside the run — with the evaluating bit kept as the
 * sign bit, as the probe wrote it.
 *
 * ## Readings
 *
 * Every run of a case writes a reading of its own, named
 * `<case>.<written>-<pid>-<n>[.<label>].story`: the digest of the case's file,
 * name and project, when it was
 * written, and the label the run gave `VARIANCE_AUTHORITY_STORY` when it gave one
 * other than `1`. A case keeps its last {@link READINGS}. One reading says
 * where the case went; two sets of them say which differences come back every
 * time and which move between runs, and a difference in the order of async work
 * is only an answer when it is the first kind.
 *
 * ## Notes
 *
 * What the code said while the case ran — a console line, an announcement, an
 * Arrange/Act/Assert marker — rides in the header as `[position, text]` over
 * the visits before the case and then its own; a test line, as a {@link TestLine}.
 *
 * ## What comes before a case
 *
 * The visits in no case's bucket immediately before the case began: the last
 * case's `afterEach` and this one's `beforeEach`, whichever the runner ran
 * outside the case's bracket. A reader labels them as before the case and never
 * as the case.
 *
 * CommonJS so the collectors can require it from inside a runner's sandbox,
 * for the reason `journal-format.cts` is.
 */

import crypto = require('node:crypto');
import fs = require('node:fs');
import path = require('node:path');
import caseOwner = require('../test-selection/case-owner.cjs');
import type { ModuleId } from '../instrument/index.js';
import type storyTap = require('../instrument/story-tap.cjs');

type Tape = ReturnType<ReturnType<typeof storyTap.createTap>['read']>;

const MAGIC = [0x56, 0x41, 0x53, 0x54, 0x52, 0x59, 0x00, 0x01];
const EVALUATING = -2147483648;
const INDEX = 0x7fffffff;

/** A story read back. */
interface Story {
  /** The test file, as the runner named it. */
  readonly file: string;
  /** The case, as the runner named it: `describe > case`. */
  readonly name: string;
  /** `[module, block count]` for every module a visit names, in first-visit order. */
  readonly rows: readonly (readonly [ModuleId, number])[];
  /** What ran outside any case just before this one began. */
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

/** How many readings of one case a directory keeps; writing another removes the oldest. */
const READINGS = 16;

/** The one case a story is of, as the start of every reading's file name. */
function caseStem(file: string, name: string, project?: string): string {
  const named = project === undefined ? `${file}\u0000${name}` : `${file}\u0000${name}\u0000${project}`;
  return crypto.createHash('sha256').update(named).digest('hex').slice(0, 32);
}

/** What a reading's file name says: its case, when it was written, and the label it was given. */
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

/** The row whose region range holds `index`: the last of `bases`, ascending, at or below it. */
function rowAt(bases: readonly number[], index: number): number {
  let low = 0;
  let high = bases.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (bases[middle]! <= index) low = middle;
    else high = middle - 1;
  }
  return low;
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
function encodeStory(tape: Tape, key: string, stopped?: boolean, page: { readonly lost?: boolean; readonly parts?: readonly Part[] } = {}): Buffer {
  const { at, keys } = tape;
  const ends = (segment: number): number => (segment + 1 < at.length ? at[segment + 1]! : tape.taped);
  const own: number[] = [];
  let interleaved = 0;
  let foreign = 0;
  for (let segment = 0; segment < keys.length; segment += 1) {
    if (keys[segment] === key) {
      if (own.length > 0 && foreign > 0) interleaved += 1;
      foreign = 0;
      own.push(segment);
    } else if (own.length > 0 && keys[segment] !== '') foreign += 1;
  }
  let first = own[0] ?? keys.length;
  while (own.length > 0 && first > 0 && keys[first - 1] === '') first -= 1;
  // What ran outside any case right after this one, up to the next case, is
  // its hooks', as what ran right before it is: a story written once its
  // attempt ended holds its `afterEach`.
  let last = own[own.length - 1] ?? -1;
  const after = own.length;
  while (last >= 0 && last + 1 < keys.length && keys[last + 1] === '') own.push((last += 1));

  const bases = tape.rows.bases;
  const dense = new Map<number, number>();
  const rows: [ModuleId, number][] = [];
  let total = 0;
  const entries: number[] = [];
  const take = (from: number, to: number): void => {
    for (let at = from; at < to; at += 1) {
      const entry = tape.tape[at]!;
      const index = entry & INDEX;
      const low = rowAt(bases, index);
      let base = dense.get(low);
      if (base === undefined) {
        base = total;
        dense.set(low, base);
        rows.push([tape.rows.ids[low]!, tape.rows.counts[low]!]);
        total += tape.rows.counts[low]!;
      }
      entries.push((base + index - bases[low]!) | (entry & EVALUATING));
    }
  };
  // Where each taken segment starts on the tape and in `entries`, so a note
  // said at a tape position lands at the visit it came after.
  const placed: [tape: number, end: number, entry: number, before: boolean][] = [];
  for (let segment = first; segment < (own[0] ?? first); segment += 1) {
    placed.push([at[segment]!, ends(segment), entries.length, true]);
    take(at[segment]!, ends(segment));
  }
  const before = entries.length;
  for (const segment of own) {
    placed.push([at[segment]!, ends(segment), entries.length, false]);
    take(at[segment]!, ends(segment));
  }

  const notes: [number, string][] = [];
  const beforeNotes: [number, string][] = [];
  const opens = own.length === 0 ? Infinity : at[own[0]!]!;
  const from = own.length === 0 ? Infinity : at[first]!;
  const trails = own.length === after ? Infinity : at[own[after]!]!;
  const closes = own.length === after ? -Infinity : ends(last);
  // Where something at a tape position in bucket `noteKey` lands: in the
  // case, before it, or neither.
  const placeOf = (position: number, noteKey: string): { said: boolean; at: number } | undefined => {
    const said = noteKey === key || (noteKey === '' && position >= trails && position <= closes);
    // What was said outside any case just before this one is its hooks'.
    if (!said && !(noteKey === '' && position >= from && position <= opens)) return undefined;
    let entry: number | undefined;
    for (const [start, end, offset, early] of placed) {
      if (position < start || early === said) continue;
      entry = offset + Math.min(position, end) - start;
    }
    return { said, at: said ? (entry ?? before) - before : (entry ?? 0) };
  };
  // How many notes each section held when the tape had said `n`, so a line
  // counts the notes said before it in the section it lands in.
  const saidBy: number[] = [0];
  const beforeBy: number[] = [0];
  for (const [position, noteKey, text] of tape.notes) {
    const place = placeOf(position, noteKey);
    if (place !== undefined) (place.said ? notes : beforeNotes).push([place.at, text]);
    saidBy.push(notes.length);
    beforeBy.push(beforeNotes.length);
  }
  const lines: TestLine[] = [];
  const beforeLines: TestLine[] = [];
  for (const [position, lineKey, line, said, hook] of tape.lines) {
    const place = placeOf(position, lineKey);
    if (place === undefined) continue;
    const counted = (place.said ? saidBy : beforeBy)[said]!;
    (place.said ? lines : beforeLines).push(hook === 1 ? [place.at, line, counted, 1] : [place.at, line, counted]);
  }
  // What a module held was said once, when it loaded, and the tape started
  // again before the first case: every case that went through it opens with it.
  const told = new Set([...notes, ...beforeNotes].map(([, text]) => text));
  const holding = rows.flatMap(([id]): [number, string][] => {
    const line = tape.held.get(id);
    return line === undefined || told.has(line) ? [] : [[0, line]];
  });
  beforeNotes.unshift(...holding);
  for (const [index, cut] of beforeLines.entries()) {
    beforeLines[index] = cut[3] === 1 ? [cut[0], cut[1], cut[2] + holding.length, 1] : [cut[0], cut[1], cut[2] + holding.length];
  }

  const { file, name, project } = caseOwner.unpackCase(key);
  const header = Buffer.from(
    JSON.stringify({
      file, name, ...(project === undefined ? {} : { project }), rows, before, untaped: tape.visits - tape.taped, interleaved, stopped,
      ...(notes.length === 0 ? {} : { notes }),
      ...(beforeNotes.length === 0 ? {} : { beforeNotes }),
      ...(tape.unnoted === 0 ? {} : { unnoted: tape.unnoted }),
      ...(lines.length === 0 ? {} : { lines }),
      ...(beforeLines.length === 0 ? {} : { beforeLines }),
      ...(page.lost === undefined ? {} : { lost: page.lost }),
      ...(page.parts === undefined || page.parts.length === 0 ? {} : { parts: page.parts }),
    }),
    'utf8',
  );
  const padded = (header.length + 3) & ~3;
  const out = Buffer.alloc(MAGIC.length + 4 + padded + entries.length * 4, 0x20);
  out.set(MAGIC, 0);
  out.writeUInt32LE(header.length, MAGIC.length);
  header.copy(out, MAGIC.length + 4);
  const body = MAGIC.length + 4 + padded;
  for (let at = 0; at < entries.length; at += 1) out.writeInt32LE(entries[at]!, body + at * 4);
  return out;
}

/** A story's bytes read back, or an error naming what they are not. */
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
