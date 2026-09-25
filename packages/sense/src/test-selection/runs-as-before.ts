/**
 * What each changed file's importers see move, read from its two texts.
 *
 * The file graph answers *what imports this*, and a walk from a changed file
 * charges every importer whatever the change was. Most of a diff is not code
 * that runs: a comment, a type, an import of a type, a file reformatted. The
 * verdict the addon gives the execution record's reading already tells those
 * apart — `none` is the one verdict that says nothing the module does moved —
 * and this asks it of the structural ground's diff, so a file that runs what it
 * ran before seeds no walk.
 *
 * The same verdict names the exports an importer would see behave differently,
 * function bodies included, so a change that moved `total` and left `label`
 * alone reaches the files that import `total` and no others. A walk narrowed by
 * those names is what the graph's lookup of each importer's bindings is for.
 *
 * The two texts have owners, and neither is recomputed: git holds the one at
 * the merge base, read through the same windowed `cat-file --batch` the
 * recording's frames use, and the working tree holds the other. No frame is
 * needed here. The execution record's line numbers are coordinates in the text
 * it ran, so its reading must find that text first; a walk over the file graph
 * charges whole files and has no coordinates to keep.
 *
 * A file is named only when both sides were read and parsed and the verdict
 * could name its exports. A file added or deleted, one that does not parse, one
 * whose load moved, one in a language the addon has no verdict for, and every
 * file on a machine without the addon are absent — changed whole, which is the
 * answer the walk already gave them.
 */

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { native } from '../addon.js';
import { MODULE_EXTENSIONS } from '../read.js';
import { textAtRecording } from './recorded-text.js';

export type RunsAsBefore =
  | {
      /**
       * Per file, in the order asked, the exports an importer sees move. Empty
       * for a file that runs what it ran before; absent for one charged whole.
       */
      readonly moved: ReadonlyMap<string, readonly string[]>;
    }
  | {
      /** No verdict could be asked on this machine, so every file stays changed. */
      readonly unread: 'addon';
    };

/**
 * What moved in each of `files` since `commit`, for its importers.
 *
 * `root` is the repository's top level and `files` are relative to it, which is
 * what git names a path by at a commit.
 */
export function runsAsBefore(root: string, commit: string, files: readonly string[]): RunsAsBefore {
  const verdict = native()?.moduleVerdict;
  if (verdict === undefined) return { unread: 'addon' };

  const modules = files.filter((file) => MODULE_EXTENSIONS.includes(extname(file)));
  const before = textAtRecording(root, modules);
  const moved = new Map<string, readonly string[]>();

  for (const file of modules) {
    const old = before(file, commit);
    if (old === undefined) continue;
    let now: string;
    try {
      now = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    const exports = verdict(file, old, now)?.moved;
    if (exports !== undefined) moved.set(file, exports);
  }

  return { moved };
}
