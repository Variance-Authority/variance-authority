/**
 * The diff the selector reads: every changed file under every name the snapshot
 * knows it by. Whether those line numbers can be trusted is the selector's own
 * question, asked through `sourceAt`.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceStem } from './page-side.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const stemOf = (path) => sourceStem(ROOT, path);

/**
 * Rewrite each file's hunks under every name the snapshot knows it by.
 *
 * `findModule` matches the recorded path exactly, so a diff naming
 * `packages/core/src/index.ts` finds the row the package's own tests entered and
 * misses the `dist` row every other package's tests went through. Only the two
 * header lines are rewritten; the hunk numbers are already in `src` coordinates.
 */
export function inSnapshotCoordinates(diff, byStem) {
  const out = [];
  let path;
  let body;

  const flush = () => {
    if (path === undefined) return;
    const names = byStem.get(stemOf(path)) ?? [path];
    for (const name of names) out.push(`--- a/${name}`, `+++ b/${name}`, ...body);
  };

  let removed;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split('\n')) {
    // A hunk header says how many lines of each side follow, and every one of
    // them is body: a removed line that begins with two dashes and a space is
    // not the next file's header. A context line counts against both sides.
    if (oldLeft > 0 || newLeft > 0) {
      if (body !== undefined) body.push(line);
      if (line.startsWith('-')) oldLeft -= 1;
      else if (line.startsWith('+')) newLeft -= 1;
      else if (!line.startsWith('\\')) {
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk !== null) {
      oldLeft = Number(hunk[1] ?? '1');
      newLeft = Number(hunk[2] ?? '1');
      if (body !== undefined) body.push(line);
      continue;
    }
    // A file the diff names without lines — a binary, a rename, a mode — has
    // this line and no header, and the selector charges it whole by this name.
    if (line.startsWith('diff --git ')) {
      flush();
      path = undefined;
      body = undefined;
      out.push(line);
      continue;
    }
    if (line.startsWith('--- ')) {
      removed = line.slice(4).replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ') && removed !== undefined) {
      flush();
      const named = line.slice(4).replace(/^b\//, '');
      // A deletion writes `+++ /dev/null` and names the file on the line above.
      path = named === '/dev/null' ? removed : named;
      removed = undefined;
      body = [];
      continue;
    }
    if (body !== undefined) body.push(line);
  }
  flush();
  return out.join('\n');
}
