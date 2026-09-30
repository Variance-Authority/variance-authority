/**
 * The reading `test:since` makes of a change, from where each test stands to
 * the files it selects. `test-since.mjs` owns the arguments, the snapshot on
 * disk, the report and the run; this owns everything between, so a check can
 * drive the whole decision over a repository of its own.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { distanceByExecution, textAtRecording } from '@variance-authority/sense/test-selection';
import { lines, readingFrom, wholeEntry, withoutFiles } from './since-base.mjs';
import { inSnapshotCoordinates } from './since-diff.mjs';
import { isManifest, movedManifests, movedPackageFiles, movedPackages } from './since-graph.mjs';

export const isTest = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);

/** Every test file the runner would collect, asked of the runner. */
export function suiteFiles(root) {
  const listed = execFileSync('yarn', ['vitest', 'list', '--filesOnly'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return listed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => isTest(line) && existsSync(resolve(root, line)));
}

/**
 * The files a change selects, or why the whole suite runs instead.
 *
 * The rule from `unenteredSubjects` in `packages/cli/src/commands/journey.ts`,
 * over files rather than subjects: skip only what the snapshot saw whole and
 * what ran nothing that changed. A file it never saw runs — a new test, a
 * test that was skipped when the snapshot was taken, a file whose observation
 * was an upper bound — and a changed test file is its own answer.
 *
 * What the reading did not measure is not an input. A changed path no test
 * ran has already said everything it can by being absent from `entered`,
 * and the only ways to the whole suite are a reading that could not be made.
 */
export function selectedFiles({ suite, whole, entered, touched, moved, base, unstarted }) {
  if (unstarted !== undefined) return { widened: `${unstarted}, so the change cannot be read from where it started` };
  if (moved === undefined) {
    return { widened: `the install could not be compared against ${base.slice(0, 12)}` };
  }
  if (!suite.some((file) => whole.has(file))) {
    return { widened: 'the snapshot has no whole observation of any file this suite collects' };
  }
  return { selected: suite.filter((file) => !whole.has(file) || entered.has(file) || touched.includes(file)) };
}

/**
 * The names one module answers to, snapshot first and the graph's own last.
 *
 * The snapshot names a module by whichever copy the runner loaded, and after
 * `foldBuilt` the graph holds only the copy the scan read. A test that entered
 * `packages/core/dist/format/canonical.js` and a graph that calls the same file
 * `packages/core/src/format/canonical.ts` have to be told they are talking about
 * one module, or every cross-package path reads as unmeasurable.
 */
const graphNames = (names, inGraph) =>
  inGraph === undefined || names.includes(inGraph) ? names : [...names, inGraph];

/**
 * Ask the snapshot once for the tests at the snapshot's commit, and once per
 * older stand for the tests standing there, and keep each answer only for the
 * tests it was asked for. One question over every stand at once would read a
 * test that ran after an edit as though it had not, and charge it whole.
 */
async function askPerStand({ snapshotFile, hunks, stands, wholePackages, byStem, options }) {
  const ask = (whole) =>
    distanceByExecution(
      snapshotFile,
      inSnapshotCoordinates([withoutFiles(hunks, whole), ...[...whole, ...wholePackages].map(wholeEntry)].join('\n'), byStem),
      options,
    );
  const owner = new Map(stands.flatMap((stand, at) => stand.tests.map((test) => [test, at])));
  const here = await ask([]);
  const mine = (at) => (test) => (owner.get(test) ?? -1) === at;
  const entered = here.narrowing.entered.filter(mine(-1));
  const because = here.narrowing.because.filter((cause) => mine(-1)(cause.test));
  const distances = here.distances.filter((distance) => mine(-1)(distance.test));
  const unread = new Set(here.narrowing.unread);
  const stale = new Set(here.narrowing.stale);
  for (const [at, stand] of stands.entries()) {
    const { narrowing, distances: far } = await ask(stand.whole);
    entered.push(...narrowing.entered.filter(mine(at)));
    because.push(...narrowing.because.filter((cause) => mine(at)(cause.test)));
    distances.push(...far.filter((distance) => mine(at)(distance.test)));
    for (const path of narrowing.unread) unread.add(path);
    for (const name of narrowing.stale) stale.add(name);
  }
  return {
    narrowing: { ...here.narrowing, entered, because, unread: [...unread].sort(), stale: [...stale].sort() },
    distances,
  };
}

/**
 * Read the change and decide what it selects.
 *
 * Answers `{ refused }` for a ref git cannot read, `{ nothing }` with the lines
 * to print when no test has anything to run, and otherwise the reading the
 * report prints and `decided`, which is `selectedFiles`' answer.
 *
 * `suite` is what the runner collects, and it decides which of the snapshot's
 * tests count: one it no longer collects never runs again, so it cannot hold a
 * reading back at an old commit or keep the tree from being settled.
 *
 * The comparison is against the working tree, because uncommitted edits are
 * what the loop before `yarn test` is about. A snapshot recorded over a dirty
 * tree is therefore diffed from a position it was never at, and two edits to
 * the same file can cancel to a region nothing entered. So the selector is
 * handed `textAtRecording` as `sourceAt`, reading the commit the snapshot
 * names: a file whose text disagrees with its recorded digest is charged every
 * region it has, under every name, and a file whose text agrees is read by the
 * parser from both sides before any line of it is charged.
 */
export async function readChange({ root, git, diffOfNew, snapshotFile, coverage, runs, ref, suite, stemOf, graph, say }) {
  const collected = new Set(suite);
  const live = coverage.tests.filter((test) => collected.has(test.file));
  const start = readingFrom({ commit: coverage.commit, ref, runs, tests: live.map((test) => test.file), git });
  if (start.refused !== undefined) return { refused: start.refused };
  const { base, from, stands } = start;
  const before = [...new Set(stands.flatMap((stand) => stand.whole))].sort();

  const byStem = new Map();
  for (const module of coverage.modules) {
    const stem = stemOf(module.file);
    byStem.set(stem, [...(byStem.get(stem) ?? []), module.file]);
  }

  const untracked = new Set(lines(git('ls-files', '--others', '--exclude-standard')));
  // Renames are read as a deletion and an addition, which is what they are to a
  // module's identity: the old path's regions are gone and the new path has none.
  const changed = [...new Set([...lines(git('diff', '--name-only', '--no-renames', base)), ...before, ...untracked])];

  // The install is read at the two revisions rather than counted as a changed
  // path, and the paths that record it are then set aside: a workspace version
  // rewrite moves hundreds of manifest lines and no installed byte. `undefined`
  // is a comparison that could not be made. A manifest whose change the install
  // does not read — `exports`, `main`, `type` — is set aside too, and its
  // package's files stand in for it. Read from where the change starts, because
  // the tests that last ran there stand on the install there.
  const moved = movedPackages(root, from, git);
  const manifests = movedManifests(root, from, git, changed);
  const consequential = changed.filter((path) => !isManifest(path));
  // A test the merge demoted to incomplete runs at the next selection, and that
  // run is what records it whole again, so nothing changed is not nothing to
  // run. A test the harness skips on this machine, a browser-gated file where
  // no browser is installed, never records whole here, so this holds only where
  // the whole suite can run; elsewhere the reading goes on and selects it.
  const settled = start.widened === undefined && live.every((test) => test.complete);
  if (settled && consequential.length === 0 && manifests.length === 0 && moved !== undefined && moved.length === 0) {
    return {
      nothing: [
        changed.length === 0
          ? `test:since: nothing has changed since ${from.slice(0, 12)}.`
          : `test:since: ${changed.length} changed manifest(s), and the install they record did not change.`,
        '  Nothing to run.',
      ],
    };
  }

  const touched = consequential.filter((path) => isTest(path));
  const product = consequential.filter((path) => !isTest(path));
  // An untracked file has no diff of its own, and the graph may still know who
  // imports it, so it is asked about as the addition it is.
  const hunks = [git('diff', '--no-renames', base), ...product.filter((path) => untracked.has(path)).map(diffOfNew)].join('\n');
  // Only a changed file with a row has line numbers to prove, so only those are
  // named up front; a twin or an importer the reading asks about is read on
  // its own. A snapshot that names no commit has no text to check against.
  const sourceAt =
    coverage.commit === undefined ? undefined : textAtRecording(root, consequential.filter((path) => byStem.has(stemOf(path))));

  const { relations, enumerated, named, faces } = await graph();
  // Named with no hunk, each is every region it has, and a file with no row is
  // answered by its importers.
  const wholePackages = relations === undefined ? [] : movedPackageFiles(relations, manifests);
  if (manifests.length > 0) {
    say(
      `test:since: ${manifests.length} manifest(s) moved what the install does not read ` +
        `(${manifests.slice(0, 3).join(', ')}${manifests.length > 3 ? ', …' : ''}); ` +
        `${wholePackages.length} file(s) of their packages are read as changed whole.`,
    );
  }
  const { narrowing, distances } = await askPerStand({
    snapshotFile,
    hunks,
    stands,
    wholePackages,
    byStem,
    options: {
      relations,
      enumerated,
      knownAs: (file) => graphNames(byStem.get(stemOf(file)) ?? [file], named?.(file)),
      faces,
      root,
      ...(sourceAt === undefined ? {} : { sourceAt }),
      ...(moved === undefined || moved.length === 0 ? {} : { packages: moved }),
    },
  });

  // A changed path the snapshot, the declarations and the graph all say
  // nothing about selects nothing, and is named so a reader can see what the
  // reading could not place.
  const changedProduct = new Set(product);
  const unentered = narrowing.unread.filter((path) => changedProduct.has(path));
  const decided = selectedFiles({
    suite,
    whole: new Set(narrowing.whole),
    entered: new Set(narrowing.entered),
    touched,
    moved,
    base: from,
    unstarted: start.widened,
  });
  return { start, changed, touched, consequential, unentered, narrowing, distances, decided };
}
