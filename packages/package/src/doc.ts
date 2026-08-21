import type { Comment } from 'oxc-parser';

/**
 * What a declaration says about itself beyond its name.
 *
 * [`declare.ts`](./declare.ts) answers *what kind of thing is this* in one word,
 * and that word is enough to watch a published surface for breakage. It is not
 * enough to **call** anything. Something handed `settle: function` still has to
 * open the file to learn what `settle` takes, and a reader that made it open the
 * file was worth nothing.
 *
 * So two more things come off the same parse, and both are bytes already in
 * memory: the head a declaration was written with, and the block comment
 * somebody wrote above it.
 *
 * ## Nothing here interprets a tag
 *
 * A `@param` stays the text it is. Every tool that has normalised doc tags has
 * ended up owning a lossy dialect of one — a `@returns` that survives and a
 * `@see` that does not, a `@example` reflowed until it stops compiling — and the
 * consumer on the other end of this reads English. The undenting is the only
 * transformation, because leading `*` columns are punctuation of the comment
 * syntax rather than of the prose.
 *
 * ## Position is found once, not per name
 *
 * A file has hundreds of declarations and hundreds of comments, and the naive
 * pairing — for each declaration, scan back for the nearest comment — is
 * quadratic on exactly the largest files. Both structures here are built in one
 * pass over the text: a comment is filed under the offset of the first thing
 * that follows it, so pairing is a lookup, and line starts are recorded so a
 * line number is a search rather than a count.
 */

/** One file's comments and lines, in the shape a lookup wants. */
export interface Writing {
  /**
   * Where a doc block's subject begins, to that block, undented.
   *
   * The key is the first non-whitespace offset after the comment — which is the
   * `export` keyword, not the declaration behind it, because that is where
   * somebody writing a doc comment puts it.
   */
  readonly docs: ReadonlyMap<number, string>;
  /** The offset each line begins at, ascending. */
  readonly lines: readonly number[];
}

/**
 * The prose of a doc block, without the punctuation that held it together.
 *
 * The leading `*` of `/**` is part of what the parser hands back as the value,
 * so the first line is stripped by the same rule as every other one.
 */
function undent(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*[ \t]?/, ''))
    .join('\n')
    .trim();
}

/** Read a file's comments and line starts, once. */
export function readWriting(text: string, comments: readonly Comment[]): Writing {
  const lines: number[] = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lines.push(at + 1);

  const docs = new Map<number, string>();
  for (const comment of comments) {
    // `/** … */` only. A `//` line above a declaration is a note to whoever is
    // editing it, and a `/* … */` is commented-out code as often as not.
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;

    let subject = comment.end;
    while (subject < text.length && /\s/.test(text.charAt(subject))) subject += 1;
    docs.set(subject, undent(comment.value));
  }

  return { docs, lines };
}

/** Which 1-based line an offset falls on. */
export function lineAt(writing: Writing, offset: number): number {
  let low = 0;
  let high = writing.lines.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((writing.lines[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/**
 * A declaration's head, verbatim.
 *
 * Everything written before the body, which is the part that says how to call
 * the thing: generics, parameters, return type, the clauses a class extends.
 * Left exactly as written, newlines and all — a signature reflowed onto one line
 * is a signature somebody has to mentally unreflow before they can trust it.
 *
 * A trailing `;` is the one thing dropped. A declaration with no body runs to
 * the end of its statement, so `type Span = readonly [number, number]` would
 * otherwise carry punctuation that `function measure(): number` does not, and
 * the difference says nothing about either shape.
 */
export function headOf(text: string, from: number, to: number): string {
  return text.slice(from, to).trimEnd().replace(/;$/, '');
}
