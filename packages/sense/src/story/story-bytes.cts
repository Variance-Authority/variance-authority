// compass: variance-authority.reach.story
/**
 * A story's bytes, written with nothing but the language.
 *
 * `format.cts` writes a test's story with these, and a page that tells its own
 * executions' stories under Vantage runs their text: `story/page-told.ts`
 * sends {@link storyBytes} and {@link rowAt} to the page as source, so they
 * close over nothing but the constants beside them and import nothing but
 * types. That is also why this module is listed in `tools/page-side.mjs`: a
 * probe the recording placed in them would name a `__va` the page lacks.
 *
 * CommonJS for the reason `format.cts` is.
 */

import type { ModuleId } from '../instrument/index.js';
import type storyTap = require('../instrument/story-tap.cjs');

type Tape = ReturnType<ReturnType<typeof storyTap.createTap>['read']>;
type Part = readonly [at: number, said: number, frame: number, document: number];
type TestLine = readonly [at: number, line: number, said: number, hook?: 1];

/** A story file's first eight bytes: `VASTRY\0\1`. */
const MAGIC = [0x56, 0x41, 0x53, 0x54, 0x52, 0x59, 0x00, 0x01];
/** The bit a visit made while its module evaluated carries, as the probe wrote it. */
const EVALUATING = -2147483648;
/** The bits of a visit that name its region. */
const INDEX = 0x7fffffff;

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

/** What a live head adds to one execution's story: whether its tape lost any of it, and the parts it was cut into. */
interface StoryPage {
  readonly lost?: boolean;
  readonly parts?: readonly Part[];
}

/**
 * The bytes of the story of the case keyed `key` on `tape`, as
 * `format.encodeStory` documents them, `owner` being the case the key names
 * and `utf8` how this realm spells text. It refers to {@link MAGIC},
 * {@link INDEX}, {@link EVALUATING} and {@link rowAt}, which a page defines
 * beside its text.
 */
function storyBytes(
  tape: Tape, key: string, owner: { readonly file: string; readonly name: string; readonly project?: string },
  utf8: (text: string) => Uint8Array, stopped?: boolean, page: StoryPage = {},
): Uint8Array {
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

  const { file, name, project } = owner;
  const header = utf8(
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
  );
  const padded = (header.length + 3) & ~3;
  const out = new Uint8Array(MAGIC.length + 4 + padded + entries.length * 4).fill(0x20);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(MAGIC.length, header.length, true);
  out.set(header, MAGIC.length + 4);
  const body = MAGIC.length + 4 + padded;
  for (let at = 0; at < entries.length; at += 1) view.setInt32(body + at * 4, entries[at]!, true);
  return out;
}

export = { storyBytes, rowAt, MAGIC, EVALUATING, INDEX };
