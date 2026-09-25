/**
 * The changed files whose runtime text did not move, read from their two texts.
 *
 * The file graph answers *what imports this*, and a walk from a changed file
 * charges every importer whatever the change was. Most of a diff is not code
 * that runs: a comment, a type, an import of a type, a file reformatted. The
 * verdict the addon gives the execution record's reading already tells those
 * apart — `none` is the one verdict that says nothing the module does moved —
 * and this asks it of the structural ground's diff, so a file that runs what it
 * ran before seeds no walk.
 *
 * The two texts have owners, and neither is recomputed: git holds the one at
 * the merge base, read through the same windowed `cat-file --batch` the
 * recording's frames use, and the working tree holds the other. No frame is
 * needed here. The execution record's line numbers are coordinates in the text
 * it ran, so its reading must find that text first; a walk over the file graph
 * charges whole files and has no coordinates to keep.
 *
 * Only `none` is returned, and only for a file both sides of which were read
 * and parsed. A file added or deleted, one that does not parse, one in a
 * language the addon has no verdict for, and every file on a machine without
 * the addon stay changed — which is the answer the walk already gave them.
 */

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { native } from '../addon.js';
import { MODULE_EXTENSIONS } from '../read.js';
import { textAtRecording } from './recorded-text.js';

export type RunsAsBefore =
  | {
      /** The files read as running what they ran before, in the order asked. */
      readonly files: readonly string[];
    }
  | {
      /** No verdict could be asked on this machine, so every file stays changed. */
      readonly unread: 'addon';
    };

/**
 * Which of `files` run as they did at `commit`.
 *
 * `root` is the repository's top level and `files` are relative to it, which is
 * what git names a path by at a commit.
 */
export function runsAsBefore(root: string, commit: string, files: readonly string[]): RunsAsBefore {
  const verdict = native()?.moduleVerdict;
  if (verdict === undefined) return { unread: 'addon' };

  const modules = files.filter((file) => MODULE_EXTENSIONS.includes(extname(file)));
  const before = textAtRecording(root, modules);
  const quiet: string[] = [];

  for (const file of modules) {
    const old = before(file, commit);
    if (old === undefined) continue;
    let now: string;
    try {
      now = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (verdict(file, old, now)?.kind === 'none') quiet.push(file);
  }

  return { files: quiet };
}
