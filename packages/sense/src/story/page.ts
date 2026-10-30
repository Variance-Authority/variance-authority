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

import storyTap from '../instrument/story-tap.cjs';
import caseOwner from '../test-selection/case-owner.cjs';
import format from './format.cjs';
import type { ModuleId } from '../instrument/index.js';
import { PAGE_STORY, type PageStory } from './page-story.js';

export { PAGE_STORY, type PageStory } from './page-story.js';

/**
 * The script that makes a page tape: installed before any document loads, so
 * the collector a bundle evaluates finds the maker and every console line a
 * case prints is a note.
 */
export function storyPageSource(): string {
  return `(() => {
const NOTE_LIMIT = ${storyTap.NOTE_LIMIT};
const NOTE_LENGTH = ${storyTap.NOTE_LENGTH};
const createTap = (${storyTap.createTap.toString()});
const NOTE = Symbol.for('variance-authority.story.note');
const realm = globalThis;
if (realm[Symbol.for(${JSON.stringify(PAGE_STORY)})] !== undefined) return;
realm[Symbol.for(${JSON.stringify(PAGE_STORY)})] = (engine) => {
  const tap = createTap(engine, ${storyTap.TAPE_LIMIT});
  tap.nameIn(realm);
  realm[NOTE] = (text) => tap.note(String(text));
  return {
    root: tap.root,
    take() {
      const read = tap.read();
      const notes = read.notes.map(([at, , text]) => [at, text]);
      const story = {
        tape: Array.from(read.tape.subarray(0, read.taped)),
        taped: read.taped,
        visits: read.visits,
        notes,
        unnoted: read.unnoted,
        held: Array.from(read.held),
        rows: { ids: read.rows.ids.slice(), counts: read.rows.counts.slice(), bases: read.rows.bases.slice() },
      };
      tap.reset();
      return story;
    },
  };
};
${PRINTING}
})();
`;
}

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
  readonly held: Map<ModuleId, string>;
  // The rows of every drain, one per module and count, at the base the story gives it.
  readonly rows: Map<string, number>;
  readonly ids: ModuleId[];
  readonly counts: number[];
  readonly bases: number[];
  visits: number;
  unnoted: number;
  total: number;
}

/** A case as the record names it: its file, repository-relative, and its test. */
export interface StoryCase {
  readonly file: string;
  readonly name: string;
  readonly id: string;
  readonly project?: string | undefined;
}

/** What a runner hands every page drain to, and asks for a case's story. */
export interface PageStories {
  /** Open what the case does next with the test line whose statement does it. */
  readonly line: (subject: StoryCase, line: number) => void;
  /** Lay a drain of one page at the end of the case's story. */
  readonly add: (subject: StoryCase, story: PageStory) => void;
  /** Write the case's story and forget it; a case that never drained writes none. */
  readonly write: (subject: StoryCase, stopped: boolean) => void;
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
      tape = { entries: [], notes: [], held: new Map(), rows: new Map(), ids: [], counts: [], bases: [], visits: 0, unnoted: 0, total: 0 };
      tapes.set(key, tape);
    }
    return tape;
  };
  return {
    line(subject, line) {
      const tape = tapeOf(subject);
      tape.notes.push([tape.entries.length, `test line ${line}`]);
    },
    add(subject, story) {
      const tape = tapeOf(subject);
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
      for (const [at, text] of story.notes) tape.notes.push([offset + at, text]);
      for (const [id, text] of story.held) tape.held.set(id, text);
      tape.visits += story.visits - story.taped;
      tape.unnoted += story.unnoted;
    },
    write(subject, stopped) {
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
          unnoted: tape.unnoted,
          held: tape.held,
          rows: { ids: tape.ids, counts: tape.counts, bases: tape.bases },
        },
        key,
        stopped,
      );
      writer(key, bytes);
    },
  };
}
