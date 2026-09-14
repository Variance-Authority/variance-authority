import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * What a README says about a name nothing was written above.
 *
 * [`doc.ts`](./doc.ts) reads the block comment above a declaration, and for most
 * names that is the whole answer. For the rest there is a second place the
 * project already explained itself, and a reader who has been told *nothing is
 * written above this declaration* is one sentence away from concluding the name
 * is undocumented when the package README has a section on it.
 *
 * ## A mention is not documentation, and is labelled as one
 *
 * What comes back is the passage of prose that names the symbol, together with
 * the file and line it was read from. It is never merged into `doc`. A
 * paragraph written about a package is written for a different reader than a
 * comment written above a function, and presenting the first as the second
 * would make every downstream count of what is documented wrong — including
 * `undocumented`, which is the work queue somebody closes.
 *
 * ## Named, not matched
 *
 * The name has to appear as a whole word. A substring hit reports that
 * `measure` is documented because the README mentions `measurements`, and a
 * confident wrong answer costs more than no answer: the reader stops looking.
 * A backticked occurrence wins over a bare one, because prose that wrote the
 * name as code is prose about the name rather than prose that happened to use
 * the word.
 */

/** A passage of a README that names a symbol. */
export interface Mention {
  /** The README, relative to the workspace root. */
  readonly at: string;
  /** The 1-based line the passage begins on. */
  readonly line: number;
  /** The passage, verbatim. */
  readonly text: string;
}

/** READMEs already read, by absolute path — one file serves every name declared under it. */
export type Readmes = Map<string, string | undefined>;

/** How much of a passage is worth carrying before it stops being a passage. */
const LONGEST = 1200;

/**
 * A cache held by one reading and discarded with it.
 *
 * Not a module-level map. The server behind this re-reads the workspace on every
 * request precisely so that the agent that just edited a file is answered from
 * the file it wrote, and a README cached across readings would be the one place
 * that quietly stopped being true.
 */
export function readmes(): Readmes {
  return new Map();
}

function reads(held: Readmes, file: string): string | undefined {
  if (held.has(file)) return held.get(file);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  held.set(file, text);
  return text;
}

/**
 * The nearest README above a file, walking up to the workspace root inclusive.
 *
 * Nearest rather than the package's, because a directory that explains itself
 * has explained itself: a README beside the source is about that source, and
 * one three levels up is about the package that contains it. Both are better
 * than nothing and the closer one is better than the further one.
 */
function nearest(root: string, at: string, held: Readmes): { text: string; from: string } | undefined {
  const parts = at.split('/').slice(0, -1);

  for (let depth = parts.length; depth >= 0; depth -= 1) {
    const dir = parts.slice(0, depth);
    const from = [...dir, 'README.md'].join('/');
    const text = reads(held, join(root, ...dir, 'README.md'));
    if (text !== undefined) return { text, from };
  }
  return undefined;
}

/** Whether an occurrence at an offset is the whole word rather than part of one. */
function whole(text: string, at: number, name: string): boolean {
  const before = at === 0 ? '' : text.charAt(at - 1);
  const after = text.charAt(at + name.length);
  return !/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after);
}

/** Every fenced block of a document, as the offsets it opens and closes at. */
function fences(text: string): readonly (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = [];

  for (let at = text.indexOf('```'); at !== -1; ) {
    const closed = text.indexOf('```', at + 3);
    if (closed === -1) {
      // A document whose last fence never closes: everything after it is code.
      spans.push([at, text.length]);
      break;
    }
    spans.push([at, closed + 3]);
    at = text.indexOf('```', closed + 3);
  }
  return spans;
}

/** The fence an offset falls inside, if it falls inside one. */
function fencing(
  spans: readonly (readonly [number, number])[],
  at: number,
): readonly [number, number] | undefined {
  return spans.find(([open, close]) => at >= open && at < close);
}

/**
 * Every offset the name is written at as a whole word, best occurrence first.
 *
 * Prose before code, and within prose a backticked occurrence before a bare
 * one. The ordering is a claim about which passage answers *what is this*:
 * prose that wrote the name as code is prose about the name, and a name inside
 * a fence is a line of an example — worth returning when it is all there is,
 * and worth returning second when there is a sentence as well.
 */
function occurrences(text: string, name: string): readonly number[] {
  const spans = fences(text);
  const quoted: number[] = [];
  const bare: number[] = [];
  const coded: number[] = [];

  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
    if (!whole(text, at, name)) continue;
    if (fencing(spans, at) !== undefined) coded.push(at);
    else if (text.charAt(at - 1) === '`' || text.charAt(at + name.length) === '`') quoted.push(at);
    else bare.push(at);
  }
  return [...quoted, ...bare, ...coded];
}

/**
 * The passage an offset falls in.
 *
 * A blank line is the unit Markdown itself separates on, so a prose hit comes
 * back as the project's own paragraph rather than a window of arbitrary width.
 * A fenced block holds blank lines of its own and would be cut through the
 * middle by that rule, so a hit inside one widens to the whole fence.
 */
function passage(text: string, at: number): { from: number; to: number } {
  const fenced = fencing(fences(text), at);

  if (fenced !== undefined) {
    const [open, close] = fenced;
    return { from: text.lastIndexOf('\n', open) + 1, to: close };
  }

  const blank = text.lastIndexOf('\n\n', at);
  const ends = text.indexOf('\n\n', at);
  return { from: blank === -1 ? 0 : blank + 2, to: ends === -1 ? text.length : ends };
}

/** Which 1-based line an offset falls on. */
function lineOf(text: string, at: number): number {
  let line = 1;
  for (let found = text.indexOf('\n'); found !== -1 && found < at; found = text.indexOf('\n', found + 1)) {
    line += 1;
  }
  return line;
}

/**
 * As much of a passage as is worth carrying, centred on the occurrence.
 *
 * Trimming from the end would be the obvious rule and it is the wrong one: a
 * long passage is long because it is a section, the name is as likely to be
 * named at the bottom of it as the top, and a cut that drops the occurrence
 * returns a paragraph that never mentions the thing it was returned for. So the
 * window is placed around the hit, snapped to line boundaries, and says on
 * whichever side it cut that it cut.
 */
function windowed(text: string, from: number, to: number, hit: number): { text: string; at: number } {
  if (to - from <= LONGEST) return { text: text.slice(from, to).trim(), at: from };

  const half = Math.floor(LONGEST / 2);
  const opened = Math.max(from, Math.min(hit - half, to - LONGEST));
  const closed = Math.min(to, opened + LONGEST);

  const head = opened === from ? from : text.indexOf('\n', opened) + 1;
  const tail = closed === to ? to : text.lastIndexOf('\n', closed);

  return {
    text: [head > from ? '…\n' : '', text.slice(head, tail).trim(), tail < to ? '\n…' : ''].join(''),
    at: head,
  };
}

/**
 * Find where a workspace's own prose names a symbol.
 *
 * Called only for names with nothing written above them, which is what keeps
 * the cost proportional to the gap rather than to the surface: a workspace that
 * documents its declarations reads no READMEs at all.
 */
export function readMention(root: string, at: string, name: string, held: Readmes): Mention | undefined {
  const found = nearest(resolve(root), at, held);
  if (found === undefined) return undefined;

  const [first] = occurrences(found.text, name);
  if (first === undefined) return undefined;

  const { from, to } = passage(found.text, first);
  const shown = windowed(found.text, from, to, first);

  return { at: found.from, line: lineOf(found.text, shown.at), text: shown.text };
}
