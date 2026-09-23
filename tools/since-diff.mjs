/**
 * The diff the selector reads: every changed file under every name the snapshot
 * knows it by, and nothing at all under a name whose line numbers cannot be
 * trusted.
 *
 * Two questions, and they compose in one direction only — {@link outOfFrame}
 * decides which files {@link inSnapshotCoordinates} must not carry hunks for —
 * so they live together rather than beside the run that asks them.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestString } from '@variance-authority/core/format';
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
 *
 * `whole` names the files whose hunks must not be read at all — the ones
 * {@link outOfFrame} found recorded from other text. Those are emitted as a
 * `diff --git` line under each name and nothing else, which is the shape git
 * writes for a binary or a rename and the shape `changedLines` charges every
 * region of. Dropping the hunks is the point rather than an economy: a range
 * added beside an empty one is read as a range, and the file would be narrowed
 * on the numbers this is refusing to trust.
 */
export function inSnapshotCoordinates(diff, byStem, whole = () => false) {
  const out = [];
  let path;
  let body;

  const flush = () => {
    if (path === undefined) return;
    const names = byStem.get(stemOf(path)) ?? [path];
    if (whole(path)) {
      for (const name of names) out.push(`diff --git a/${name} b/${name}`);
      return;
    }
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

/**
 * The changed files whose recorded line numbers are coordinates in some other text.
 *
 * A snapshot is recorded by being run, and the loop this serves runs over a
 * dirty tree, so the ranges are the working tree's while the label is the
 * commit's. Every hunk read against the wrong one of those lands on whatever
 * region occupies those numbers now, which belongs to different tests or to
 * none — and the error is not in the safe direction. The recorder wrote a digest
 * of the text it cut the ranges from, so the question is answerable: hash the
 * text at the position the snapshot names and compare.
 *
 * ## Why this asks per stem rather than handing `narrowByExecution` a `sourceAt`
 *
 * `sourceAt` is the shipped shape of this check and it is asked per *name*,
 * against the digest on that name's own row. A built twin has a row, and its
 * `sourceDigest` is a digest of the built JavaScript on disk — `probes.ts` takes
 * it off whatever file the bundler resolved — while the ranges on that same row
 * are in `src` line numbers, translated back through the map the transform
 * carried. So no text git holds can satisfy a `dist` row: not the source, which
 * is different text, and not the built file, which is not in the index at all.
 * Wired straight through, `textAtRecording` reports every built twin stale and
 * charges every region of it, which on this repository turns a one-line edit to
 * `packages/core/src/format/value.ts` from 29 test files into 237.
 *
 * The stem is the unit the question actually has an answer at. Both rows carry
 * the same `src` coordinates, so both are in frame exactly when the source is,
 * and the source row's digest is a digest of source. Ask once, under the name
 * git tracks, and charge every name the answer covers.
 *
 * A stem the snapshot holds only a `dist` row for — a package barrel no test
 * imports by its source path — has no recorded digest of source to compare
 * against and is left unchecked, which is the reading this had before the check
 * existed.
 *
 * ## Which paths are worth fetching
 *
 * Only the ones with a digest to disagree with, which is why `sourceAt` arrives
 * as a factory rather than already built. A diff is asked about in full — that
 * is what decides which files are charged whole — but most of a wide one is
 * paths the snapshot holds no source row for at all: a fixture, a manifest, a
 * page-side module, a built twin, a file added since. Reading the text of one of
 * those out of git costs a tree walk and a copy of the file for an answer the
 * loop below never reaches. So the intersection is taken first and the fetch is
 * sized by that, not by the diff.
 */
export function outOfFrame(coverage, paths, sourceAtFor) {
  const changed = new Set(paths);
  const digests = new Map(
    coverage.modules
      .filter(
        (module) =>
          module.instrumented && !module.file.includes('/dist/') && changed.has(module.file),
      )
      .map((module) => [module.file, module.sourceDigest]),
  );

  // No source row: nothing to disagree with. A file with no row at all is
  // answered by the files that import it, or is `unread` and selects nothing;
  // either way it has no line numbers to disagree with. One with an
  // uninstrumented row is the build saying it never read the module, and its
  // zero blocks are not numbers anybody is about to trust.
  const checkable = paths.filter((path) => digests.has(path));
  if (checkable.length === 0) return new Set();
  const sourceAt = sourceAtFor(checkable);

  return new Set(
    checkable.filter((path) => {
      const text = sourceAt(path, coverage.commit);
      // A row for a file the position does not hold — added since, or never
      // committed — describes a text nothing at that commit can be, which is the
      // same disagreement as a digest that differs.
      return text === undefined || digestString(text) !== digests.get(path);
    }),
  );
}
