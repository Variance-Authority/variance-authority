/**
 * The reading `test:since` makes of a change, from where each test stands to
 * the files it selects. `test-since.mjs` owns the arguments, the snapshot on
 * disk, the report and the run; this owns everything between, so a check can
 * drive the whole decision over a repository of its own.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  askPerStand,
  distanceByExecution,
  keptTexts,
  readingFrom,
  textAtRecording,
  wholeEntry,
  withoutFiles,
} from '@variance-authority/sense/test-selection';
import { inSnapshotCoordinates } from './since-diff.mjs';
import { isManifest, movedManifests, movedPackageFiles, movedPackages } from './since-graph.mjs';

/**
 * The paths of one git answer asked with `-z`, as git wrote them. Without `-z`,
 * git C-quotes a path holding a quote, a backslash, a tab or a newline whatever
 * `core.quotePath` says, and a trimmed line loses a path's own leading space.
 */
const paths = (text) => text.split('\0').filter((path) => path !== '');

export const isTest = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);

/** Every test file the runner would collect under one config, asked of the runner. */
export function suiteFiles(root, config) {
  const listed = execFileSync('yarn', ['vitest', 'list', '--filesOnly', '--config', config], {
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
 * names, and `keptTexts` for the text a landing kept when that commit does
 * not hold it. A file whose recorded text is found either way is read by the
 * parser from both sides before any line of it is charged; one whose recorded
 * text neither holds is charged every region it has, under every name.
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

  const untracked = new Set(paths(git('ls-files', '-z', '--others', '--exclude-standard')));
  // Renames are read as a deletion and an addition, which is what they are to a
  // module's identity: the old path's regions are gone and the new path has none.
  const sinceBase = new Set([...paths(git('diff', '--name-only', '-z', '--no-renames', base)), ...untracked]);
  const changed = [...new Set([...sinceBase, ...before])];

  // The install is read at the two revisions rather than counted as a changed
  // path, and the paths that record it are then set aside: a workspace version
  // rewrite moves hundreds of manifest lines and no installed byte. `undefined`
  // is a comparison that could not be made. A manifest whose change the install
  // does not read — `exports`, `main`, `type` — is set aside too, and its
  // package's files stand in for it. Read once per group of tests, from the
  // commit that group last ran at, because each stands on the install there: a
  // bump made after a leg and undone in the tree moved nothing for the tests
  // that ran before it, and everything for the tests that ran on it.
  const groups = [base, ...stands.map((stand) => stand.commit)];
  const sinceGroup = (at) => (at === base ? [...sinceBase] : [...new Set([...sinceBase, ...stands.find((stand) => stand.commit === at).whole])]);
  const movedAt = new Map(movedPackages(root, groups, git).map((moved, index) => [groups[index], moved]));
  const manifestsAt = new Map(groups.map((at) => [at, movedManifests(root, at, git, sinceGroup(at))]));
  const uncompared = groups.findIndex((at) => movedAt.get(at) === undefined);
  const manifests = [...new Set([...manifestsAt.values()].flat())].sort();
  const consequential = changed.filter((path) => !isManifest(path));
  // Every file the runner collects needs a whole row before nothing changed is
  // nothing to run. A test the merge demoted to incomplete runs at the next
  // selection, and that run is what records it whole again; a collected file
  // with no row at all — new, never reached, or one that failed to load — is
  // selected by `selectedFiles`, and its absence is not a row saying it is
  // settled. A test the harness skips on this machine, a browser-gated file
  // where no browser is installed, never records whole here, so this holds only
  // where the whole suite can run; elsewhere the reading goes on and selects it.
  const complete = new Map(live.map((test) => [test.file, test.complete]));
  const settled = start.widened === undefined && suite.every((file) => complete.get(file) === true);
  if (settled && consequential.length === 0 && manifests.length === 0 && [...movedAt.values()].every((moved) => moved?.length === 0)) {
    return {
      nothing: [
        changed.length === 0
          ? `test:since: nothing has changed since ${from.slice(0, 12)}.`
          : `test:since: ${changed.length} changed manifest(s), and the install they record did not change.`,
        ...(start.assumed === undefined ? [] : [`  ${start.assumed[0].toUpperCase()}${start.assumed.slice(1)}.`]),
        '  Nothing to run.',
      ],
    };
  }

  // A test file is its own answer only when it changed after it last ran: after
  // `base` for every test, and before it only for a test standing where it did.
  const touched = consequential.filter(
    (path) => isTest(path) && (sinceBase.has(path) || stands.some((stand) => stand.whole.includes(path) && stand.tests.includes(path))),
  );
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
  const packageFiles = (at) => (relations === undefined ? [] : movedPackageFiles(relations, manifestsAt.get(at)));
  if (manifests.length > 0) {
    say(
      `test:since: ${manifests.length} manifest(s) moved what the install does not read ` +
        `(${manifests.slice(0, 3).join(', ')}${manifests.length > 3 ? ', …' : ''}); ` +
        `${new Set(groups.flatMap(packageFiles)).size} file(s) of their packages are read as changed whole.`,
    );
  }
  const options = {
    relations,
    enumerated,
    knownAs: (file) => graphNames(byStem.get(stemOf(file)) ?? [file], named?.(file)),
    faces,
    root,
    ...(sourceAt === undefined ? {} : { sourceAt, keptText: keptTexts(root) }),
  };
  // Asked once per stand, each answer kept for that stand's tests; the files a
  // stand charges whole leave the hunk diff, so none is also read by its hunks,
  // and each is charged the packages that moved since it ran.
  const { narrowing, distances } = await askPerStand(stands, (whole, stand) => {
    const at = stand ?? base;
    const moved = movedAt.get(at) ?? [];
    return distanceByExecution(
      snapshotFile,
      inSnapshotCoordinates([withoutFiles(hunks, whole), ...[...whole, ...packageFiles(at)].map(wholeEntry)].join('\n'), byStem),
      moved.length === 0 ? options : { ...options, packages: moved },
    );
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
    moved: uncompared === -1 ? [] : undefined,
    base: uncompared === -1 ? from : groups[uncompared],
    unstarted: start.widened,
  });
  return { start, changed, touched, consequential, unentered, narrowing, distances, decided };
}
