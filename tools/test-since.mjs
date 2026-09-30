#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atDistance,
  distanceRange,
  groupByDistance,
  readCommitRuns,
  readTestCoverage,
  remaining,
} from '@variance-authority/sense/test-selection';
import { sourceStem } from './page-side.mjs';
import { readChange, suiteFiles } from './since-change.mjs';
import { importGraph } from './since-graph.mjs';
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

// Paths come back as they are spelled on disk, not C-quoted: every git answer
// read here is compared with a path some other owner spelled. `core.quotePath`
// only covers bytes above ASCII, so a name list is also asked with `-z`.
const git = (...args) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The diff an untracked file would have, had it been added. */
const diffOfNew = (path) =>
  spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--no-index', '--', '/dev/null', path], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;

/**
 * The record to measure from, which `suiteBase` in `@variance-authority/cli`
 * orders, and the note that says whose it is: this checkout's own, else the
 * mainline's, fetched now or as last fetched on this machine, else the primary
 * checkout's as the offline fallback, with the reason no mainline record was
 * read. `variance select` asks the same `suiteBase` and prints the same notes.
 * Nothing here writes but the fetch, which keeps the mainline's bytes in the
 * cache's read layer and names them in `fetched.json` there, where the run this
 * selects lays them under its own record.
 */
export async function recordToRead(root, cacheRoot, env) {
  const { mainlineMissed, mainlineRead, primaryRead, suiteBase } = await import('@variance-authority/cli');
  const base = await suiteBase(root, { ...(cacheRoot === undefined ? {} : { cacheRoot }), ...(env === undefined ? {} : { env }) });
  if (base.from === 'mainline') return { ...base, note: mainlineRead(base.mainline) };
  if (base.from === 'primary' && base.missed !== undefined) return { ...base, note: primaryRead(base.missed.suite, base.file, base.missed) };
  return base.missed === undefined ? base : { ...base, note: mainlineMissed(base.missed) };
}

const say = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);

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
 * Everything above is the reading; this is the decision and the run.
 *
 * Behind the usual guard so the reading can be imported — `tools/test-since.check.ts`
 * checks {@link recordToRead} and the modules this calls against the
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

  const base = await recordToRead(ROOT);
  const snapshotFile = base.file;
  if (base.from === 'none' || !existsSync(snapshotFile)) {
    say(
      'test:since: no execution snapshot on disk, so nothing here has an opinion about anything.',
      `  looked in ${snapshotFile}`,
      ...(base.note === undefined ? [] : [`  mainline ${base.note}`]),
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
   * Where to measure from, which `readChange` in `since-change.mjs` owns. Hunks
   * are read from the snapshot's own commit whenever it names one: its line
   * ranges are in that commit's coordinates and no other's. A test the runs at
   * that commit did not observe stands where it last ran, and `readingFrom` in
   * `@variance-authority/sense/test-selection` says what is charged whole for
   * it. A ref is a lower bound,
   * resolved to its merge base so a branch behind `main` is not told that
   * everything anybody else merged has changed here — the same reason
   * `packages/cli/src/commands/since.ts` does.
   *
   * The runs are read beside whichever snapshot is read. A worktree that has
   * not run reads the mainline's snapshot, or the primary checkout's, and the
   * runs beside it describe that snapshot; the worktree's own would describe
   * nothing it reads. The mainline's record has beside it the runs record the
   * run that published it wrote, when the entry carried one. `readingFrom` says
   * what it read in place of an answer whenever the runs beside the snapshot
   * cannot give one: there are none, they are another commit's, or they do not
   * list where a test in the snapshot last ran.
   */
  let runs;
  try {
    runs = coverage.commit === undefined ? undefined : await readCommitRuns(snapshotFile);
  } catch (error) {
    // It says where each test last ran, and a selection that guessed would
    // skip tests that should run, so nothing is narrowed on it. What to do
    // depends on whose record it is, one case per place a record is read from.
    const remedy = {
      own: '  Run `yarn test`, which rewrites it; delete it first only if it is a directory.',
      mainline: "  It is the mainline's record, as last fetched: run `yarn test` here, which writes this checkout's own.",
      primary: "  It is the primary checkout's record: run `yarn test` here, which writes this worktree's own.",
    }[base.from];
    say(
      `test:since: ${error?.message ?? error}.`,
      '  It says where each test in the snapshot last ran, so nothing is selected without it.',
      remedy,
    );
    return 1;
  }
  let suite;
  try {
    suite = suiteFiles(ROOT);
  } catch (error) {
    // The runner has already printed why on stderr; what is left to say is
    // which question went unanswered and what that stops.
    const status = typeof error?.status === 'number' ? `exited ${error.status}` : `failed: ${String(error?.message ?? error).split('\n')[0]}`;
    say(`test:since: \`yarn vitest list --filesOnly\` ${status}, so there is no suite to select from.`);
    return 1;
  }
  const read = await readChange({
    root: ROOT,
    git,
    diffOfNew,
    snapshotFile,
    coverage,
    runs,
    ref,
    suite,
    stemOf,
    graph: () => importGraph({ root: ROOT, stemOf }),
    say,
  });
  if (read.refused !== undefined) {
    say(`test:since: ${read.refused}.`, '  Pass a branch, a tag or a commit this checkout has, or no ref at all.');
    return 1;
  }
  if (read.nothing !== undefined) {
    say(...read.nothing);
    return 0;
  }
  const { start, changed, touched, consequential, unentered, narrowing, distances, decided } = read;
  const { from } = start;
  const because = new Map(narrowing.because.map((cause) => [cause.test, cause]));
  if (unentered.length > 0) {
    say(
      `test:since: ${unentered.length} changed path(s) neither the recording nor the import graph lists ` +
        `(${unentered.slice(0, 3).join(', ')}${unentered.length > 3 ? ', …' : ''}).`,
    );
  }

  if (decided.widened !== undefined) {
    say(
      `test:since: running the whole suite — ${decided.widened}.`,
      ...recordLine(base),
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
    ...recordLine(base),
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
