/**
 * A diff between two texts nobody committed, from git.
 *
 * Git owns the hunk arithmetic every other reading of a change here takes, so a
 * change read against a text only the cache holds is written by the same
 * `diff`, over two scratch files, rather than by a second implementation.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedLines, type LineRange } from './diff-lines.js';
import { applied, hunksOf, type Hunk } from './patch.js';

/** The `-U0` hunks, headers and bodies, that turn `before` into `after`; empty when they are equal. */
export function diffTexts(before: string, after: string): string {
  if (before === after) return '';
  const directory = mkdtempSync(join(tmpdir(), 'variance-texts-'));
  try {
    writeFileSync(join(directory, 'before'), before);
    writeFileSync(join(directory, 'after'), after);
    let output: string;
    try {
      output = execFileSync(
        'git',
        ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U0', 'before', 'after'],
        { cwd: directory, encoding: 'utf8', maxBuffer: 1 << 28 },
      );
    } catch (error) {
      // `diff --no-index` exits 1 when the texts differ, which is the case
      // here. Any other status is git failing, and its output is not a diff.
      const { status, stdout } = error as { status?: unknown; stdout?: unknown };
      if (status !== 1 || typeof stdout !== 'string') throw error;
      output = stdout;
    }
    const first = output.search(/^@@ /mu);
    return first === -1 ? '' : output.slice(first);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** One file's change, as `changedLines` and `hunksOf` read it. */
export interface Rebased {
  readonly ranges: readonly LineRange[];
  readonly hunks: readonly Hunk[];
}

/**
 * The change a diff makes to `file`, read from `recorded` instead of the text
 * the diff was written against.
 *
 * The diff's new side is its old side — `base`, the text at the commit, or
 * nothing for a file the commit does not hold — with its hunks applied. The
 * change from the recorded text to that is what the tests have not run. Absent
 * when the hunks do not apply to `base`, because the diff was written against
 * some other text and there is no new side to read, and when git could not diff
 * the two texts. The caller charges the module whole either way.
 */
export function rebasedChange(
  file: string,
  recorded: string,
  base: string | undefined,
  hunks: readonly Hunk[],
): Rebased | undefined {
  const after = applied(base ?? '', hunks)?.after;
  if (after === undefined) return undefined;
  let body: string;
  try {
    body = diffTexts(recorded, after);
  } catch {
    return undefined;
  }
  if (body === '') return { ranges: [], hunks: [] };
  const diff = `--- a/${file}\n+++ b/${file}\n${body}`;
  return { ranges: changedLines(diff).get(file) ?? [], hunks: hunksOf(diff).get(file) ?? [] };
}
