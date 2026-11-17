// compass: variance-authority.reach.story
/**
 * Stories of cases whose code runs in a page: a browser test, a Playwright
 * spec, Vitest in browser mode.
 *
 * The page tapes and the runner writes. {@link storyPageSource} is a script a
 * runner puts on the page before its documents load; it leaves a maker on the
 * realm, and the page collector hands its engine to the maker instead of using
 * the engine's root itself. Every drain then carries the tape since the drain
 * before as a {@link PageStory}, and {@link pageStories} lays a case's drains
 * end to end, each opened by the test line the runner drained it under, and
 * encodes the case as a Node seam does.
 *
 * A page has one bucket and knows no case: which case a drain belongs to is the
 * runner's to say, and a runner that drains between cases says it exactly.
 */

import storyFrames from '../instrument/story-frames.cjs';
import storyListen from '../instrument/story-listen.cjs';
import storyParts from '../instrument/story-parts.cjs';
import storyTap from '../instrument/story-tap.cjs';
import caseOwner from '../test-selection/case-owner.cjs';
import format from './format.cjs';
import storyBytes from './story-bytes.cjs';
import type { ModuleId } from '../instrument/index.js';
import { PAGE_STORY, type PageStory } from './page-story.js';

/**
 * The script that makes a page tape: installed before any document loads, so
 * the collector a bundle evaluates finds the maker and every console line a
 * case prints is a note. `limit` bounds what the page keeps between two drains.
 *
 * Given `part`, the page tapes as a live head does, everything it runs into
 * that one part, bounded per execution: a page that tells its own executions
 * takes the part from the tap when one ends, as `page-told.ts` does, and a
 * runner that drains such a page takes it in its stead.
 */
export function storyPageSource(limit = storyTap.TAPE_LIMIT, part?: string): string {
  return `(() => {
const NOTE_LIMIT = ${storyTap.NOTE_LIMIT};
const NOTE_LENGTH = ${storyTap.NOTE_LENGTH};
${part === undefined ? '' : LIVE}const createTap = (${storyTap.createTap.toString()});
const watchPage = (${storyListen.watchPage.toString()});
const watchFrames = (${storyFrames.watchFrames.toString()});
const NOTE = Symbol.for('variance-authority.story.note');
const realm = globalThis;
if (realm[Symbol.for(${JSON.stringify(PAGE_STORY)})] !== undefined) return;
realm[Symbol.for(${JSON.stringify(PAGE_STORY)})] = (engine) => {
  const tap = ${part === undefined ? `createTap(engine, ${limit})` : `createTap({ ...engine, current: () => (${JSON.stringify({ key: part })}) }, ${limit}, true)`};
  tap.nameIn(realm);
  // What has the page watch say a line's changes, kept so a runner whose test
  // lines run outside the page can open and close them.
  let turn = () => {};
  watchPage({ note: (text) => tap.note(text), drainWith: (given) => { tap.drainWith(given); turn = given; } }, realm);
  realm[NOTE] = (text) => tap.note(String(text));
  const frames = watchFrames(tap, realm);
  // The runner takes a case's tape after its hooks and before the next case:
  // settled first, so the last line hears what it changed. A runner that drains
  // before each statement says whether the next one is a test line.
  const take = (opens) => {
      if (opens === true) turn(true);
      else tap.settle();
      frames();
      // A live tap keeps what ran in its part, which a driver that claims the page takes.
      const read = ${part === undefined ? 'tap.read()' : `tap.take(${JSON.stringify(part)})`};
      const notes = read.notes.map(([at, , text]) => [at, text]);
      const lines = read.lines.map(([at, , line, said, hook]) => (hook === 1 ? [at, line, said, 1] : [at, line, said]));
      const story = {
        tape: Array.from(read.tape.subarray(0, read.taped)),
        taped: read.taped,
        visits: read.visits,
        notes,
        lines,
        unnoted: read.unnoted,
        held: Array.from(read.held),
        rows: { ids: read.rows.ids.slice(), counts: read.rows.counts.slice(), bases: read.rows.bases.slice() },
      };
      tap.reset();
      return story;
  };
  return { root: tap.root, take };
};
${PRINTING}
})();
`;
}

// What a live tap's parts close over: \`story-parts.cts\` and the one function of \`story-bytes.cts\` it reads.
const LIVE = `const PART_LIMIT = ${storyParts.PART_LIMIT};
const PART_NOTES = ${storyParts.PART_NOTES};
const PART_TEXT_BYTES = ${storyParts.PART_TEXT_BYTES};
const utf8Length = (${storyParts.utf8Length.toString()});
const encodedLength = (${storyParts.encodedLength.toString()});
const storyBytes = { rowAt: (${storyBytes.rowAt.toString()}) };
const storyParts = { createParts: (${storyParts.createParts.toString()}) };
`;

// What a case prints is a note, as \`listen\` makes it in Node, and still
// printed. A page has no \`util.format\`: each value is joined as \`String\`
// spells it, which is what the console shows for the values a case prints.
const PRINTING = `
const printer = realm.console;
if (printer !== undefined && printer[NOTE] !== true) {
  Object.defineProperty(printer, NOTE, { value: true });
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = printer[method];
    if (typeof original !== 'function') continue;
    printer[method] = function (...values) {
      const channel = realm[NOTE];
      if (typeof channel === 'function') {
        try {
          channel('console.' + method + ' ' + values.map((value) => String(value)).join(' '));
        } catch {
          // A value whose spelling throws is still printed below.
        }
      }
      return original.apply(this, values);
    };
  }
}`;

/** One case's story, assembled from the drains of every page it ran in. */
interface CaseTape {
  readonly entries: number[];
  readonly notes: [number, string][];
  readonly lines: [number, number, number, 1?][];
  readonly held: Map<ModuleId, string>;
  // Where the story moves into another realm, and the frames and documents it met.
  readonly parts: [number, number, number, number][];
  readonly frames: Map<object, { readonly frame: number; document: number }>;
  documents: number;
  // The rows of every drain, one per module and count, at the base the story gives it.
  readonly rows: Map<string, number>;
  readonly ids: ModuleId[];
  readonly counts: number[];
  readonly bases: number[];
  visits: number;
  unnoted: number;
  total: number;
}

/** A case as the record names it: its file, as its runner reports the path, and its test. */
export interface StoryCase {
  readonly file: string;
  readonly name: string;
  readonly id: string;
  readonly project?: string | undefined;
}

/** What a runner hands every page drain to, and asks for a case's story. */
export interface PageStories {
  /** Open what the case does next with the test line whose statement does it, a hook's where `hook` says so. */
  readonly line: (subject: StoryCase, line: number, hook?: boolean) => void;
  /**
   * Lay a drain of one page at the end of the case's story. `frame` is the
   * frame it was drained from, any object that stays the same across its
   * documents; where it is given, the story says which frame and document
   * each part ran in, so a reader never orders two frames' work under one
   * statement by the order their drains arrived in.
   */
  readonly add: (subject: StoryCase, story: PageStory, frame?: object) => void;
  /** Put what the case said in the runner's own process at the end of its story so far, bounded as a tap bounds a note. */
  readonly note: (subject: StoryCase, text: string) => void;
  /**
   * Write the case's story and forget it; a case that never drained writes
   * none. `lost` says a page the case ran in was gone before it was drained.
   */
  readonly write: (subject: StoryCase, stopped: boolean, lost?: boolean) => void;
}

/** Assemble page stories per case and write each one into `directory`. */
export function pageStories(directory: string): PageStories {
  const writer = format.storyWriter(directory);
  const tapes = new Map<string, CaseTape>();
  const keyOf = ({ file, name, id, project }: StoryCase): string => caseOwner.packCase(file, name, id, project);
  const tapeOf = (subject: StoryCase): CaseTape => {
    const key = keyOf(subject);
    let tape = tapes.get(key);
    if (tape === undefined) {
      tape = { entries: [], notes: [], lines: [], held: new Map(), parts: [], frames: new Map(), documents: 0, rows: new Map(), ids: [], counts: [], bases: [], visits: 0, unnoted: 0, total: 0 };
      tapes.set(key, tape);
    }
    return tape;
  };
  // A part opens where the story moves into a realm other than the one it was in.
  const enter = (tape: CaseTape, frame: number, document: number): void => {
    const at = tape.entries.length;
    const said = tape.notes.length;
    const same = (part: readonly number[] | undefined): boolean => part !== undefined && part[2] === frame && part[3] === document;
    if (same(tape.parts.at(-1))) return;
    // A part nothing ran in gives way to the next, as a line does.
    const last = tape.parts.at(-1);
    if (last !== undefined && last[0] === at && last[1] === said) tape.parts.pop();
    if (!same(tape.parts.at(-1))) tape.parts.push([at, said, frame, document]);
  };
  // What a frame drains is the document it holds, until it replaces it.
  const documentOf = (tape: CaseTape, frame: object, replaced: boolean): [number, number] => {
    let known = tape.frames.get(frame);
    if (known === undefined) {
      known = { frame: tape.frames.size + 1, document: (tape.documents += 1) };
      tape.frames.set(frame, known);
    } else if (replaced) known.document = tape.documents += 1;
    return [known.frame, known.document];
  };
  const stories: PageStories = {
    // FIXME: a drain that reaches the runner after the next line is cut lays
    // what the page did before it under that later line.
    line(subject, line, hook) {
      const tape = tapeOf(subject);
      const at = tape.entries.length;
      const said = tape.notes.length;
      const cut: [number, number, number, 1?] = hook === true ? [at, line, said, 1] : [at, line, said];
      // A line nothing followed, visit or note, gives way to the next, as the tap's does.
      const last = tape.lines[tape.lines.length - 1];
      if (last !== undefined && last[0] === at && last[2] === said) tape.lines[tape.lines.length - 1] = cut;
      else tape.lines.push(cut);
    },
    add(subject, story, frame) {
      // What the documents this page replaced ran comes first, as they ran it,
      // each a document of its own in the same frame.
      const replaced = story.before ?? [];
      for (const [index, before] of replaced.entries()) {
        if (frame !== undefined) enter(tapeOf(subject), ...documentOf(tapeOf(subject), frame, index > 0));
        stories.add(subject, before);
      }
      const tape = tapeOf(subject);
      if (frame !== undefined) enter(tape, ...documentOf(tape, frame, replaced.length > 0));
      const offset = tape.entries.length;
      const { bases } = story.rows;
      // A page's row is the story's row for the same module and count: two
      // pages, or one page loaded twice, enter the same regions.
      const rebased = bases.map((base, row) => {
        const name = `${story.rows.ids[row]!}\u0000${story.rows.counts[row]!}`;
        let at = tape.rows.get(name);
        if (at === undefined) {
          at = tape.total;
          tape.rows.set(name, at);
          tape.ids.push(story.rows.ids[row]!);
          tape.counts.push(story.rows.counts[row]!);
          tape.bases.push(at);
          tape.total += story.rows.counts[row]!;
        }
        return at - base;
      });
      for (const entry of story.tape) {
        const index = entry & 0x7fffffff;
        tape.entries.push((index + rebased[format.rowAt(bases, index)]!) | (entry & format.EVALUATING));
      }
      const said = tape.notes.length;
      for (const [at, line, before, hook] of story.lines) tape.lines.push(hook === 1 ? [offset + at, line, said + before, 1] : [offset + at, line, said + before]);
      for (const [at, text] of story.notes) tape.notes.push([offset + at, text]);
      for (const [id, text] of story.held) tape.held.set(id, text);
      tape.visits += story.visits - story.taped;
      tape.unnoted += story.unnoted;
    },
    note(subject, text) {
      const tape = tapeOf(subject);
      if (tape.parts.length > 0) enter(tape, 0, 0);
      if (tape.notes.length >= storyTap.NOTE_LIMIT) {
        tape.unnoted += 1;
        return;
      }
      const line = text.length > storyTap.NOTE_LENGTH ? `${text.slice(0, storyTap.NOTE_LENGTH - 1)}…` : text;
      tape.notes.push([tape.entries.length, line]);
    },
    write(subject, stopped, lost) {
      const key = keyOf(subject);
      const tape = tapes.get(key);
      tapes.delete(key);
      if (tape === undefined) return;
      const bytes = format.encodeStory(
        {
          tape: Int32Array.from(tape.entries),
          taped: tape.entries.length,
          visits: tape.entries.length + tape.visits,
          at: [0],
          keys: [key],
          notes: tape.notes.map(([at, text]) => [at, key, text] as const),
          lines: tape.lines.map(([at, line, said, hook]) => (hook === 1 ? ([at, key, line, said, 1] as const) : ([at, key, line, said] as const))),
          unnoted: tape.unnoted,
          held: tape.held,
          rows: { ids: tape.ids, counts: tape.counts, bases: tape.bases },
        },
        key,
        stopped,
        {
          ...(lost === undefined ? {} : { lost }),
          // A case that ran in one realm moved nowhere.
          ...(new Set(tape.parts.map(([, , frame, document]) => `${frame}\u0000${document}`)).size < 2 ? {} : { parts: tape.parts }),
        },
      );
      writer(key, bytes);
    },
  };
  return stories;
}
