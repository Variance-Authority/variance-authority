#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atDistance,
  declaredSuites,
  distanceByExecution,
  distanceRange,
  groupByDistance,
  readCommitRuns,
  readTestCoverage,
  readableTestCoverage,
  remaining,
  testCoverageFile,
  textAtRecording,
} from '@variance-authority/sense/test-selection';
import { sourceStem } from './page-side.mjs';
import { excluding, lines, readingFrom, wholeEntry } from './since-base.mjs';
import { inSnapshotCoordinates } from './since-diff.mjs';
import { importGraph, isManifest, movedManifests, movedPackageFiles, movedPackages } from './since-graph.mjs';
import { costLine, describeRange, distanceLines, explain, findingLines, helpLines, readingLines, recordLine, runningLines } from './since-report.mjs';

/**
 * Run the tests a change reached, from the suite's own record of itself.
 *
 * This repository ships test selection, and until this file existed it ran three
 * hundred test files to find out whether a comment was spelled right. `yarn test`
 * now instruments what it loads and writes down which test file entered which
 * region; this reads that back and asks it the question it was recorded to
 * answer. `yarn test` is still the gate. This is the loop before it.
 *
 * ## What it selects on, and what it does not
 *
 * What the recording measured, and nothing else. The snapshot speaks for the
 * modules the build put probes in. A changed path it has no row for — a
 * page-side module that cannot take a probe, a file every test mocks, a file
 * added since the recording — is asked of the import graph instead: whoever
 * imports it, and whoever imports them, until the chain arrives at a module the
 * snapshot did record or a test file. The measured importers answer with their
 * tests, and an importer nobody measured answers with nothing. A path neither
 * the snapshot nor the graph lists — prose, a fixture, a workflow — selects
 * nothing on its own and is named in one line above the selection. What the
 * harness loads without importing it is declared rather than guessed at: the
 * seam declares `vitest.config.mts` and the local modules it imports, the
 * config names the rest in `preconditions`, and a change to any of them retires
 * every observation that declared it.
 *
 * The whole suite runs only when the reading itself could not be made: an
 * install that could not be compared, or a snapshot with no whole observation
 * of any file this suite collects. A test file is its own row: nothing
 * instruments one, and nothing has to, because the test a change to it selects
 * is itself.
 *
 * ## Usage
 *
 * `yarn test:since --help` prints it, from `helpLines` in `since-report.mjs`.
 * That is the copy a reader gets without opening this file, so it is the one
 * kept current.
 *
 * ## Distance, and what a green leg is worth
 *
 * A change to something everything imports selects nearly everything, and that
 * answer is correct and no use. But the selection is not flat: a test that
 * imports the edited module is one hop from it, its callers' tests are two, and
 * a failure at one hop has one explanation where a failure at four has a chain
 * of them. `--at-distance` takes those hop counts, so a loop can find out it was
 * wrong in six seconds rather than find out it was right in eleven minutes. Each
 * leg is a smaller claim than the last, and the report counts the files it left
 * for a later one so the two are never confused. A green leg is not a green
 * suite, which `--help` and AGENTS.md say once rather than every run.
 *
 * ## Two shapes it reports whether or not anything failed
 *
 * A **reach-through** is a hop that landed inside a directory rather than on the
 * `index` module that directory publishes itself as: the change travelled past
 * an interface somebody wrote, and the fix is at the importing line rather than
 * anywhere near whatever broke. An **unplaced** test entered the changed module
 * along no chain of imports it executed — a registry, a singleton, a patched
 * prototype, a module-level assignment two files agree about and nothing
 * declares. Both are defects with an address, and neither needs a red test to be
 * worth reading. `docs/distance.md` argues both at length.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The diff an untracked file would have, had it been added. */
const diffOfNew = (path) =>
  spawnSync('git', ['diff', '--no-index', '--', '/dev/null', path], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;

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
 * The one declared suite's record, from the nearest cache layer holding it, and
 * whether that layer is this checkout's own. `readableTestCoverage` owns that
 * lookup, and `variance select` asks it too. Nothing here writes.
 */
export async function recordToRead(root, cacheRoot) {
  const declared = declaredSuites(root);
  const options = { suite: declared?.length === 1 ? declared[0].name : undefined, cacheRoot };
  const file = await readableTestCoverage(root, options);
  return { file, own: file === testCoverageFile(root, options) };
}

const say = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);

const isTest = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);

/**
 * The stem the snapshot would hold this file under, if it holds it at all.
 *
 * A module arrives at the runner twice, and `tools/page-side.mjs` already had to
 * fold the two together to decide what to instrument — same rule, asked from the
 * other end. A package's own tests import `packages/core/src/index.ts`; every
 * other package resolves `packages/core/dist/index.js` through the manifest's
 * `exports`, and a worktree's links can spell that one
 * `../../../packages/core/dist/index.js`. All
 * three names are one edit.
 *
 * The recorded extents are in `src` line numbers either way — probes are placed
 * after the transform and translated back through the map it carried — so a hunk
 * header lands on the region an author edited under whichever name it is asked
 * about.
 */
const stemOf = (path) => sourceStem(ROOT, path);

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

/** Every test file the runner would collect, asked of the runner. */
function suiteFiles() {
  const listed = execFileSync('yarn', ['vitest', 'list', '--filesOnly'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return listed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => isTest(line) && existsSync(resolve(ROOT, line)));
}

/**
 * Everything above is the reading; this is the decision and the run.
 *
 * Behind the usual guard so the reading can be imported — `tools/test-since.check.ts`
 * checks {@link selectedFiles} and {@link inSnapshotCoordinates} against the
 * claims their comments make, and importing a module that has already run the
 * suite is not a check anybody wants twice.
 */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    say(...helpLines());
    return 0;
  }

  const dryRun = argv.includes('--dry-run');
  const distanceAt = argv.indexOf('--at-distance');
  // `--at-distance` with nothing after it is a typo, not a request for every
  // distance, and answering it with the whole run would answer a different
  // question.
  const asked = distanceAt < 0 ? undefined : (argv[distanceAt + 1] ?? '');
  const ref = argv.find((argument, at) => !argument.startsWith('-') && at !== distanceAt + 1);

  const { file: snapshotFile, own } = await recordToRead(ROOT);
  if (!existsSync(snapshotFile)) {
    say(
      'test:since: no execution snapshot on disk, so nothing here has an opinion about anything.',
      `  looked in ${snapshotFile}`,
      '  Run `yarn test` once — it records what each file entered — and ask again.',
    );
    return 1;
  }

  /**
   * A snapshot this build cannot decode, which is neither of the other two absences.
   *
   * The reader throws on purpose: a caller about to *exclude* tests must not be
   * handed an empty answer where an unreadable file would read as nothing
   * recorded. So the three cases are answered apart. No file is the one above —
   * ordinary, and the operator's next move is to run the suite once. Nothing
   * whole is the widen at the bottom — the snapshot read, and had nothing to say
   * about any file this suite collects. This one is neither: the bytes are there
   * and this build does not know the format, which happens across a format
   * version and is fixed by recording again rather than by reading further.
   *
   * The path is worth printing in full. The snapshot lives outside the
   * repository, under a directory keyed by this checkout's absolute path:
   * `git clean` does not reach it, and two checkouts of the same repository do
   * not share one.
   *
   * The message says only to record again. A recording run layers onto
   * whatever it finds and treats bytes it cannot decode as nothing to layer
   * onto, so it replaces this file rather than failing on it and there is
   * nothing to delete first. Nothing is narrowed on a file this cannot read: a
   * run that ignored it would look exactly like a run with nothing recorded.
   */
  let coverage;
  try {
    coverage = await readTestCoverage(snapshotFile);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      say(
        'test:since: the execution snapshot went away while this was reading it.',
        `  looked in ${snapshotFile}`,
        '  Run `yarn test` once and ask again.',
      );
      return 1;
    }
    say(
      `test:since: the execution snapshot is not one this build can read: ${error?.message ?? error}.`,
      `  at ${snapshotFile}`,
      '  Run `yarn test` once to replace it.',
    );
    return 1;
  }

  // What the runner reported each file cost when it was recorded; a file it did
  // not time is absent here, and the cost line counts it apart.
  const recorded = new Map(
    coverage.tests.flatMap((test) => (test.duration === undefined ? [] : [[test.file, test.duration]])),
  );

  if (ref === undefined && coverage.commit === undefined) {
    say(
      'test:since: the snapshot names no commit, so there is no coordinate to measure from.',
      '  Pass a ref — `yarn test:since main` — or re-record inside a checkout.',
    );
    return 1;
  }

  /**
   * Where to measure from, and why it is always the working tree on the other side.
   *
   * Hunks are read from the snapshot's own commit whenever it names one: its
   * line ranges are in that commit's coordinates and no other's. The change can
   * start earlier, and `readingFrom` in `since-base.mjs` says where and what it
   * charges whole. A ref is resolved to its merge base so a branch behind `main`
   * is not told that everything anybody else merged has changed here — the same
   * reason `packages/cli/src/commands/since.ts` does.
   *
   * The comparison is against the working tree either way, because uncommitted
   * edits are what the loop before `yarn test` is about. A snapshot recorded
   * over a dirty tree is therefore diffed from a position it was never at, and
   * two edits to the same file can cancel to a region nothing entered. So the
   * selector is handed `textAtRecording` as `sourceAt`, reading the commit the
   * snapshot names: a file whose text disagrees with its recorded digest is
   * charged every region it has, under every name, and a file whose text agrees
   * is read by the parser from both sides before any line of it is charged. A
   * snapshot that names no commit has no position to read the text from, and
   * is not checked.
   */
  const runs = own && coverage.commit !== undefined ? await readCommitRuns(snapshotFile) : undefined;
  const start = readingFrom({ commit: coverage.commit, ref, runs, tests: coverage.tests.map((test) => test.file), git });
  const { base, from, whole: before } = start;

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
  // rewrite moves hundreds of manifest lines and no installed byte, and the
  // comparison has already said so. `undefined` is a comparison that could not
  // be made. A manifest whose change the install does not read — `exports`,
  // `main`, `type` — is set aside too, and its package's files stand in for it.
  // Read from where the change starts, because the tests the snapshot's commit
  // did not run stand on the install there.
  const moved = movedPackages(ROOT, from, git);
  const manifests = movedManifests(ROOT, from, git, changed);
  const consequential = changed.filter((path) => !isManifest(path));
  // A test the merge demoted to incomplete runs at the next selection, and that
  // run is what records it whole again, so nothing changed is not nothing to run.
  const settled = start.widened === undefined && coverage.tests.every((test) => test.complete);
  if (settled && consequential.length === 0 && manifests.length === 0 && moved !== undefined && moved.length === 0) {
    say(
      changed.length === 0
        ? `test:since: nothing has changed since ${from.slice(0, 12)}.`
        : `test:since: ${changed.length} changed manifest(s), and the install they record did not change.`,
      '  Nothing to run.',
    );
    return 0;
  }

  const suite = suiteFiles();
  const touched = consequential.filter((path) => isTest(path));
  const product = consequential.filter((path) => !isTest(path));

  // An untracked file has no diff of its own, and the graph may still know who
  // imports it, so it is asked about as the addition it is.
  const diff = [
    git('diff', '--no-renames', base, ...excluding(before)),
    ...product.filter((path) => untracked.has(path)).map(diffOfNew),
  ].join('\n');
  // Only a changed file with a row has line numbers to prove, so only those are
  // named up front; a twin or an importer the reading asks about is read on
  // its own.
  const sourceAt =
    coverage.commit === undefined
      ? undefined
      : textAtRecording(ROOT, consequential.filter((path) => byStem.has(stemOf(path))));

  const { relations, enumerated, named, faces } = await importGraph({ root: ROOT, stemOf });
  // Named with no hunk, each is every region it has, and a file with no row is
  // answered by its importers.
  const wholePackages = movedPackageFiles(relations, manifests);
  if (manifests.length > 0) {
    say(
      `test:since: ${manifests.length} manifest(s) moved what the install does not read ` +
        `(${manifests.slice(0, 3).join(', ')}${manifests.length > 3 ? ', …' : ''}); ` +
        `${wholePackages.length} file(s) of their packages are read as changed whole.`,
    );
  }
  const { narrowing, distances } = await distanceByExecution(
    snapshotFile,
    inSnapshotCoordinates(
      [diff, ...[...before, ...wholePackages].map(wholeEntry)].join('\n'),
      byStem,
    ),
    {
      relations,
      enumerated,
      knownAs: (file) => graphNames(byStem.get(stemOf(file)) ?? [file], named(file)),
      faces,
      root: ROOT,
      ...(sourceAt === undefined ? {} : { sourceAt }),
      ...(moved === undefined || moved.length === 0 ? {} : { packages: moved }),
    },
  );
  const whole = new Set(narrowing.whole);
  const because = new Map(narrowing.because.map((cause) => [cause.test, cause]));

  // A changed path the snapshot, the declarations and the graph all say
  // nothing about selects nothing, and is named so a reader can see what the
  // reading could not place.
  const changedProduct = new Set(product);
  const unentered = narrowing.unread.filter((path) => changedProduct.has(path));
  if (unentered.length > 0) {
    say(
      `test:since: ${unentered.length} changed path(s) neither the recording nor the import graph lists ` +
        `(${unentered.slice(0, 3).join(', ')}${unentered.length > 3 ? ', …' : ''}).`,
    );
  }

  const decided = selectedFiles({
    suite,
    whole,
    entered: new Set(narrowing.entered),
    touched,
    moved,
    base: from,
    unstarted: start.widened,
  });
  if (decided.widened !== undefined) {
    say(
      `test:since: running the whole suite — ${decided.widened}.`,
      recordLine(snapshotFile, own),
      `  ${suite.length} files`,
      costLine(suite, recorded),
      '',
    );
    if (dryRun) return 0;
    return spawnSync('yarn', ['vitest', 'run'], { cwd: ROOT, stdio: 'inherit' }).status ?? 1;
  }
  const { selected } = decided;

  const why = (file) => {
    const cause = because.get(file);
    if (cause !== undefined) return explain(cause);
    if (touched.includes(file)) return 'changed';
    return 'no whole observation';
  };

  // A selected file the reading never placed is still selected, and its distance
  // is the one nobody could measure — never the nearest. `distances` speaks only
  // for what a change reached; the rest of `selected` is here because the
  // snapshot could not speak for it at all, which is a different sentence and
  // the same absence of a hop count.
  const placed = new Map(distances.map((distance) => [distance.test, distance]));
  const reading = selected.map((file) => placed.get(file) ?? { test: file });
  const groups = groupByDistance(reading);
  const range =
    asked === undefined ? { from: 0, to: Number.MAX_SAFE_INTEGER } : distanceRange(asked);
  if (range === undefined) {
    say(
      `test:since: \`--at-distance ${asked ?? ''}\` is not a range of hop counts.`,
      '  Write `0-2` for everything within two imports, `2` for exactly two, or `3-` for the rest.',
      `  This reading measured ${groups.filter((group) => !group.unplaced).length} distinct distance(s).`,
    );
    return 1;
  }

  const running = atDistance(reading, range.from, range.to);
  const left = remaining(reading, range.from, range.to);
  const at = (file) => {
    const group = groups.find((candidate) => candidate.tests.includes(file));
    return group === undefined || group.unplaced ? '  ·' : `${`${group.hops}`.padStart(3)}`;
  };

  say(
    `test:since: ${selected.length} of ${suite.length} files, at ${groups.length} distance(s).`,
    recordLine(snapshotFile, own),
    `  base     ${from.slice(0, 12)} — ${start.says}`,
    `  changed  ${changed.length} path(s): ${touched.length} test file(s), ${changed.length - consequential.length} manifest(s), ${unentered.length} unlisted`,
    `  skipped  ${suite.length - selected.length} file(s): recorded whole, ran nothing that changed`,
    costLine(running, recorded),
    ...(narrowing.stale.length === 0
      ? []
      : [
          `  stale    ${narrowing.stale.length} recorded name(s) cut from other text: every region charged`,
        ]),
    ...readingLines(narrowing.readings ?? []),
    '',
    ...distanceLines(groups),
    '',
    ...(asked === undefined
      ? []
      : [
          `  ${range.from}${range.to === range.from ? '' : `-${range.to === Number.MAX_SAFE_INTEGER ? '' : range.to}`} hops: running ${running.length}, leaving ${left.length} for a later leg.`,
          '',
        ]),
    ...runningLines(running.slice(0, 25), at, why),
    ...(running.length > 25 ? [`  … and ${running.length - 25} more`] : []),
    '',
    ...findingLines(reading),
  );

  if (dryRun) return 0;
  if (running.length === 0) {
    // An empty leg is not an empty selection. A change whose nearest test is
    // four hops away has nothing within two, and saying that nothing entered the
    // change would be a different and false sentence.
    say(
      asked === undefined
        ? '  No test ran what changed.'
        : `  No selected test is ${describeRange(range)} from the change. ${left.length} file(s) are further out.`,
    );
    return 0;
  }
  const result = spawnSync('yarn', ['vitest', 'run', ...running], { cwd: ROOT, stdio: 'inherit' });
  if (left.length > 0) {
    const further = range.to === Number.MAX_SAFE_INTEGER ? '' : `; \`--at-distance ${range.to + 1}-\` runs those further out`;
    say('', `test:since: ${left.length} selected file(s) were not in this leg${further}.`);
  }
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
