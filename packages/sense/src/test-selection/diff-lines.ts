/**
 * Reading a unified diff into the old-side line ranges it changed, per file.
 *
 * The half of selection that never looks at a snapshot: what `git diff` wrote,
 * read the way git meant it. Every shape a header or hunk takes that a naive
 * reader gets wrong is spelled out on `changedLines`.
 */

export interface LineRange {
  readonly start: number;
  readonly end: number;
  /**
   * The text this range is charged for, when it is charged for added text
   * alone. Present only on the gap an insertion opens, where the old file has no
   * line to point at and the range is the two lines around the gap; absent on a
   * range a removal charged, whose line is its own evidence. A reader that can
   * tell inert text from text that runs uses it to charge nobody.
   */
  readonly added?: string;
}

/**
 * The lines a diff actually changed, in the coordinates the journal is indexed
 * by. A file with no lines is one the diff names without any: a binary, a pure
 * rename, a mode change, each of which git writes as a `diff --git` line with
 * no hunk header under it, and each of which the reader charges whole.
 *
 * Three things a hunk header does not say, and each of them decides a run.
 *
 * **The span is not the change.** `@@ -48,7 @@` is seven lines of which one may
 * be edited; the other six are context, printed so a human can find the place.
 * Read as a range, an edit to a single `onClick` claims the six lines around it
 * — the end of the component body — and every subject that ever rendered the
 * component has entered one of them. The narrowing that separates *the effect
 * every story runs* from *the handler one story clicks* survives only if a
 * context line is not a change.
 *
 * **A deletion still has coordinates.** `+++ /dev/null` is the whole header on
 * the new side, and the hunks under it are entirely old lines — the side this
 * reads. Keyed off `+++` alone, a commit that removed a module every subject
 * crosses named no file and contributed nothing.
 *
 * **A rename's hunks are the old file's too.** `--- a/old` over `+++ b/new`
 * carries old-side numbers of `old`, the name the snapshot has rows under; the
 * new name has none, and is named whole so the graph is asked who imports it.
 *
 * **A pure insertion is placed after its line, not on it.** `@@ -5,0 +6,3 @@`
 * removes nothing, and the `5` is then the line the new text follows rather
 * than the first line of a span — the one place the old-side number means
 * something else. Read as a span it charges lines four and five; the text sits
 * between five and six.
 *
 * An insertion is charged to the lines on both sides of the gap it opens. The
 * new text is between them and belongs to whichever region spans it, and that is
 * knowable from the old file only as *one of these two*.
 */
export function changedLines(diff: string): ReadonlyMap<string, readonly LineRange[]> {
  const byFile = new Map<string, LineRange[]>();
  let removed: string | undefined;
  let file: string | undefined;
  let old = 0;
  // A context line is one line of body that counts against both sides, so the
  // body ends when both are spent — not after `old + new` lines, which counts
  // every context line twice and eats the next file's header.
  let oldLeft = 0;
  let newLeft = 0;
  // How many lines the current run removed and how many it has added so far:
  // an addition past the count removed is text the old file had no line for.
  let removedRun = 0;
  let addedRun = 0;
  let hunk: LineRange | undefined;
  let marked = false;
  let named: readonly string[] | undefined;

  const mark = (from: number, to: number, added?: string): void => {
    if (file === undefined) return;
    const start = Math.max(from, 1);
    const end = Math.max(to, 1);
    const ranges = byFile.get(file) ?? [];
    // Every added line of one run opens the same gap, so they are one range and
    // one piece of text: read apart, a function declaration would be judged a
    // line at a time and each line alone is a fragment.
    const last = ranges[ranges.length - 1];
    if (added !== undefined && last?.added !== undefined &&
      last.start === start && last.end === end) {
      ranges[ranges.length - 1] = { start, end, added: `${last.added}\n${added}` };
    } else {
      ranges.push({ start, end, ...(added === undefined ? {} : { added }) });
    }
    byFile.set(file, ranges);
    marked = true;
  };

  // A hunk whose body says nothing is a hunk that must widen to its header. It
  // is not a shape git writes, and a reader that answered `no lines changed` to
  // one would rule subjects out of a diff it failed to parse.
  const close = (): void => {
    if (hunk !== undefined && !marked) mark(hunk.start, hunk.end);
    hunk = undefined;
    removedRun = 0;
    addedRun = 0;
  };

  // A `diff --git` line that no `+++` follows is a file the diff names and
  // shows nothing of. Charged whole, under both names it gives.
  const settle = (): void => {
    if (named === undefined) return;
    for (const path of named) if (!byFile.has(path)) byFile.set(path, []);
    named = undefined;
  };

  for (const line of diff.split(/\r?\n/)) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('-')) {
        mark(old, old);
        old += 1;
        removedRun += 1;
        oldLeft -= 1;
      } else if (line.startsWith('+')) {
        newLeft -= 1;
        addedRun += 1;
        // Within one run, git writes every removal before the additions that
        // replace them, and there is no correspondence between the two counts —
        // one line can become three. An addition matched by a removal rewrites
        // the line that removal already charged. An addition past the count
        // removed, and one in a run that removed nothing, is text the old file
        // had no line for: it opens a gap after the last line the run touched
        // and belongs to whichever region spans the old lines on either side
        // of that gap. Three lines replacing one `return` inside a branch are
        // the branch on both readings; three lines replacing the brace that
        // closes it are the branch *and* what follows the brace, and reading
        // them as the branch alone skips every test that ran what follows.
        if (addedRun > removedRun) mark(old - 1, old, line.slice(1));
      } else if (!line.startsWith('\\')) {
        old += 1;
        removedRun = 0;
        addedRun = 0;
        oldLeft -= 1;
        newLeft -= 1;
      }
      if (oldLeft <= 0 && newLeft <= 0) close();
      continue;
    }

    close();

    if (line.startsWith('diff --git ')) {
      settle();
      named = gitPaths(line.slice(11));
      file = undefined;
      continue;
    }
    if (line.startsWith('--- ')) {
      removed = diffPath(line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      const added = diffPath(line.slice(4));
      file = removed ?? added;
      named = undefined;
      // Named and, so far, shown nothing of: charged whole, and a hunk below
      // narrows that. A hunk this reader does not understand — a combined
      // diff's `@@@` — leaves it whole rather than making the file vanish.
      if (file !== undefined && !byFile.has(file)) byFile.set(file, []);
      if (added !== undefined && added !== file && !byFile.has(added)) byFile.set(added, []);
      continue;
    }
    if (file === undefined || !line.startsWith('@@ ')) continue;

    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match === null) continue;

    const at = Number(match[1]);
    const count = Number(match[2] ?? '1');
    old = count === 0 ? at + 1 : at;
    oldLeft = count;
    newLeft = Number(match[4] ?? '1');
    removedRun = 0;
    addedRun = 0;
    marked = false;
    hunk = count === 0 ? { start: at, end: at + 1 } : { start: at, end: at + count - 1 };
  }

  close();
  settle();

  return byFile;
}

/**
 * The two paths of `diff --git a/X b/Y`. Git separates them with one space and
 * quotes only a path that needs it, so an unquoted path holding ` b/` is
 * ambiguous; the split that names one file twice is the ordinary case and is
 * preferred, and the first split otherwise.
 */
function gitPaths(rest: string): readonly string[] {
  if (rest.startsWith('"')) {
    const [left, remainder] = quoted(rest);
    const right = remainder.startsWith(' "') ? quoted(remainder.slice(1))[0] : remainder.slice(1);
    return left.slice(2) === right.slice(2) ? [left.slice(2)] : [left.slice(2), right.slice(2)];
  }
  const splits: Array<readonly [string, string]> = [];
  for (let at = rest.indexOf(' b/'); at !== -1; at = rest.indexOf(' b/', at + 1)) {
    const left = rest.slice(0, at);
    if (left.startsWith('a/')) splits.push([left.slice(2), rest.slice(at + 3)]);
  }
  const same = splits.find(([left, right]) => left === right);
  const [left, right] = same ?? splits[0] ?? [rest, rest];
  return left === right ? [left] : [left, right];
}

export function diffPath(value: string): string | undefined {
  const path = value.startsWith('"') ? quoted(value)[0] : value.split('\t')[0];
  if (path === undefined || path === '/dev/null') return undefined;
  return path.startsWith('b/') || path.startsWith('a/') ? path.slice(2) : path;
}

/**
 * A path git quoted, and what follows the closing quote.
 *
 * Git writes a path holding a byte outside printable ASCII — every accented
 * name, under the default `core.quotepath` — as a C string: double quotes
 * around it, `\\`, `\"`, `\t`, `\n`, `\r` for those characters and `\ooo` for
 * every other byte, in octal. The bytes are UTF-8 once unescaped, and a reader
 * that took the quoted form as the name would match nothing the snapshot holds.
 */
function quoted(value: string): readonly [string, string] {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let at = 1;
  while (at < value.length && value[at] !== '"') {
    const char = value[at]!;
    if (char !== '\\') {
      bytes.push(...encoder.encode(char));
      at += 1;
      continue;
    }
    const escaped = value[at + 1] ?? '';
    const octal = /^[0-7]{1,3}/.exec(value.slice(at + 1));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      at += 1 + octal[0].length;
    } else {
      bytes.push(...encoder.encode(UNESCAPED[escaped] ?? escaped));
      at += 2;
    }
  }
  return [new TextDecoder().decode(new Uint8Array(bytes)), value.slice(at + 1)];
}

const UNESCAPED: Readonly<Record<string, string>> = { t: '\t', n: '\n', r: '\r', a: '\u0007', b: '\b', f: '\f', v: '\v' };
