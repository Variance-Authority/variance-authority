/**
 * A file's text on both sides of a diff, from the old side and the hunks.
 *
 * Selection reads a hunk as line numbers, and line numbers alone cannot say
 * whether the line is a comment, a type, or the constant three functions read.
 * The parser can, given both texts. The diff's old side is the text the caller
 * already holds the frame for; the new side is that text with the hunks applied,
 * so no working tree and no second commit is asked for.
 *
 * Every context and removed line is checked against the old text. One line that
 * disagrees and there is no new text at all: the diff was written against
 * something else, and the reading that depends on it is not made.
 */

import { diffPath } from './diff-lines.js';

export interface Patched {
  readonly after: string;
  /** Each run of removed and added lines, which is the unit a change is judged in. */
  readonly runs: readonly Run[];
}

/**
 * One contiguous run of `-` and `+` lines.
 *
 * `removed` are old line numbers; `added` are new ones. `gap` is the pair of
 * old lines around an insertion that outnumbers its removals — the range
 * `changedLines` charges for the surplus — and is absent when the run added no
 * more lines than it removed.
 */
export interface Run {
  readonly removed: readonly number[];
  readonly added: readonly number[];
  readonly gap?: readonly [number, number];
}

interface Hunk {
  readonly at: number;
  readonly count: number;
  readonly lines: readonly string[];
}

/** The hunks of every file in the diff, under the name `changedLines` gives it. */
export function hunksOf(diff: string): ReadonlyMap<string, readonly Hunk[]> {
  const byFile = new Map<string, Hunk[]>();
  let removed: string | undefined;
  let file: string | undefined;
  let hunk: { at: number; count: number; lines: string[] } | undefined;
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (hunk !== undefined && (oldLeft > 0 || newLeft > 0)) {
      hunk.lines.push(line);
      if (line.startsWith('-')) oldLeft -= 1;
      else if (line.startsWith('+')) newLeft -= 1;
      else if (!line.startsWith('\\')) {
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      file = undefined;
      removed = undefined;
    } else if (line.startsWith('--- ')) {
      removed = diffPath(line.slice(4));
    } else if (line.startsWith('+++ ')) {
      file = removed ?? diffPath(line.slice(4));
    } else if (file !== undefined && line.startsWith('@@ ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      if (match === null) continue;
      const count = Number(match[2] ?? '1');
      hunk = { at: Number(match[1]), count, lines: [] };
      oldLeft = count;
      newLeft = Number(match[3] ?? '1');
      byFile.set(file, [...(byFile.get(file) ?? []), hunk]);
    }
  }

  return byFile;
}

/**
 * The old text with the hunks applied, and the runs they changed. `undefined`
 * when a context or removed line is not the old text's line at that number.
 */
export function applied(before: string, hunks: readonly Hunk[]): Patched | undefined {
  const old = before.split('\n');
  const after: string[] = [];
  const runs: Run[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    // `@@ -5,0` inserts after line 5; `@@ -5,2` starts at it.
    const begin = hunk.count === 0 ? hunk.at : hunk.at - 1;
    if (begin < cursor || begin > old.length) return undefined;
    while (cursor < begin) after.push(old[cursor++]!);

    let run: { removed: number[]; added: number[]; gap?: [number, number] } | undefined;
    const close = (): void => {
      if (run !== undefined) runs.push(run);
      run = undefined;
    };
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue;
      if (line.startsWith('-') || line.startsWith('+')) {
        run ??= { removed: [], added: [] };
        if (line.startsWith('-')) {
          if (old[cursor] !== line.slice(1)) return undefined;
          cursor += 1;
          run.removed.push(cursor);
        } else {
          after.push(line.slice(1));
          run.added.push(after.length);
          if (run.added.length > run.removed.length) run.gap = [cursor, cursor + 1];
        }
        continue;
      }
      close();
      if (old[cursor] !== line.slice(1)) return undefined;
      after.push(old[cursor++]!);
    }
    close();
  }
  while (cursor < old.length) after.push(old[cursor++]!);

  return { after: after.join('\n'), runs };
}
