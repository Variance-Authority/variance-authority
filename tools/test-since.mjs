#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { openSourceIndex, scanRelations } from '@variance-authority/sense';
import {
  bandRange,
  bandsOf,
  distanceByExecution,
  indexFaces,
  readTestCoverage,
  slice,
  tail,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';
import { sourceStem } from './page-side.mjs';
import { bandLines, findingLines } from './since-report.mjs';

/**
 * Run the tests a change reached, from the suite's own record of itself.
 *
 * This repository ships test selection, and until this file existed it ran three
 * hundred test files to find out whether a comment was spelled right. `yarn test`
 * now instruments what it loads and writes down which test file entered which
 * region; this reads that back and asks it the question it was recorded to
 * answer. `yarn test` is still the gate. This is the loop before it.
 *
 * ## What it will not do
 *
 * Narrow on a guess. The snapshot speaks for the modules the build carried
 * probes into. A changed path it has no row for — a page-side module that
 * cannot hold a probe, a file every test mocks, a file added since the
 * recording — is asked of the import graph instead: whoever imports it, and
 * whoever imports them, until the chain reaches a module the snapshot did
 * record or a test file. That answer is the tests those importers reach, which
 * is wider than the truth and never narrower. Every other changed path — a
 * fixture, a manifest, anything the scan does not read — is a fact nothing here
 * has an opinion about, and *no row* reads identically to *nobody entered this*
 * while meaning the opposite. So that change runs everything and says which
 * path did it. `unenteredSubjects` in `packages/cli/src/commands/journey.ts` is
 * where that rule is argued, over subjects rather than files; this restates it
 * because the CLI does not export it.
 *
 * Two kinds of path are exempt, and both are exempt for a reason about reach
 * rather than convenience. A test file is its own row: nothing instruments one,
 * and nothing has to, because the test a change to it selects is itself. And
 * {@link INERT} is the set nothing the suite loads can open.
 *
 * ## Usage
 *
 * ```bash
 * yarn test:since            # since the commit the snapshot was recorded at
 * yarn test:since main       # since the merge base with main
 * yarn test:since --dry-run  # decide, explain, run nothing
 * yarn test:since --band 1-3 # the three nearest rings only
 * yarn test:since --band 4-  # the rest of them
 * ```
 *
 * ## Bands, and what a green one is worth
 *
 * A change to something everything imports selects nearly everything, and that
 * answer is correct and no use: the same run with a paragraph attached. But the
 * selection is not flat. The edited module's own test is one hop from it, its
 * callers' tests are two, and a failure at one hop has one explanation where a
 * failure at four has a chain of them. `--band` runs a slice of those rings, so
 * a loop can spend six seconds finding out it was wrong before it spends eleven
 * minutes finding out it was right.
 *
 * Each leg is a smaller claim than the last. A green suite is the gate; a green
 * `test:since` is the tests a change reached; a green band is the ones it
 * reached soonest, and the report says which files it did not run so the number
 * is never mistaken for the other one.
 *
 * ## Two shapes it reports whether or not anything failed
 *
 * A **reach-through** is a hop that landed inside a directory rather than on the
 * `index` module that directory publishes itself as. The change travelled past
 * an interface somebody wrote, and the fix is at the importing line rather than
 * anywhere near whatever broke.
 *
 * An **unplaced** test entered the changed module along no chain of imports it
 * executed. Effect at a distance in the literal sense: a registry, a singleton,
 * a patched prototype, a module-level assignment two files agree about and
 * nothing declares. Both are defects with an address, and neither needs a red
 * test to be worth reading.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Paths a change to which cannot alter what `yarn test` does.
 *
 * Narrow on purpose. Everything the snapshot has no row for widens the run to
 * everything, and in a repository whose prose is a third of its diffs that would
 * answer "all of them" to almost every question. So the exemption is stated
 * rather than inferred, and is about reach: nothing the suite loads opens any of
 * these.
 *
 * `tools/` is deliberately absent. `vitest.config.mts` imports
 * `tools/page-side.mjs`, so a file there decides what the suite instruments, and
 * the checks beside it read the tree as data. A change there widens.
 */
export const INERT = [
  'docs/',
  'site/',
  'backlog/',
  '.github/',
  '.changeset/',
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'LICENSE',
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The diff an untracked file would have, had it been added. */
const diffOfNew = (path) =>
  spawnSync('git', ['diff', '--no-index', '--', '/dev/null', path], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;

/** Where the suite's imports point, scanned from the same directories `yarn test` collects. */
async function importGraph(snapshotFile) {
  const source = await openSourceIndex(resolve(dirname(snapshotFile), 'source-index.bin'));
  const records = await scanRelations({
    root: ROOT,
    dirs: ['packages', 'tools', 'cases'],
    cache: source.cache,
    reuse: source.reuse,
  });
  await source.save();

  // The scan reads `packages`, `tools` and `cases`, so a workspace package
  // imported through its manifest lands on a `dist` node nothing ever opened.
  // The graph holds that node and knows nothing about it, and the reading next
  // door has to be able to tell that apart from a module that imports nothing.
  const read = new Set(records.filter((record) => record.unknown === undefined).map((record) => record.file));
  return { relations: relationsOfFiles(records), enumerated: (file) => read.has(file) };
}

/** One line for why a test file is in the run. */
export function explain(cause) {
  const reason = cause.via[0];
  const more = cause.via.length > 1 ? ` (+${cause.via.length - 1})` : '';
  switch (reason.kind) {
    case 'region':
      return `${reason.file}:${reason.startLine}-${reason.endLine} ${reason.path}${more}`;
    case 'precondition':
      return `precondition ${reason.name}${more}`;
    case 'importer':
      return `${reason.trail.join(' → ')}${more}`;
    default:
      return reason.kind;
  }
}

const say = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);

const isTest = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
const isInert = (path) =>
  INERT.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));

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
 * holds {@link INERT} and {@link inSnapshotCoordinates} to the claims their
 * comments make, and importing a module that has already run the suite is not a
 * check anybody wants twice.
 */
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const bandAt = argv.indexOf('--band');
  // `--band` with nothing after it is a typo, not a request for every band, and
  // answering it with the whole run would be answering a different question.
  const band = bandAt < 0 ? undefined : (argv[bandAt + 1] ?? '');
  const ref = argv.find((argument, at) => !argument.startsWith('-') && at !== bandAt + 1);

  const snapshotFile = testCoverageFile(ROOT);
  if (!existsSync(snapshotFile)) {
    say(
      'test:since: no execution snapshot on disk, so nothing here has an opinion about anything.',
      `  looked in ${snapshotFile}`,
      '  Run `yarn test` once — it records what each file entered — and ask again.',
    );
    return 1;
  }

  const coverage = await readTestCoverage(snapshotFile);
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
   * The snapshot's own commit whenever it names one: its line ranges are in that
   * commit's coordinates and no other's, and a hunk read anywhere else lands on
   * lines it never numbered once `main` has moved. A ref only decides the base
   * for a snapshot that names no commit, and is resolved to its merge base so a
   * branch behind `main` is not told that everything anybody else merged has
   * changed here — the same reason `packages/cli/src/commands/since.ts` does.
   *
   * The comparison is against the working tree either way, because uncommitted
   * edits are what the loop before `yarn test` is about. The corollary is that a
   * snapshot recorded over a dirty tree answers wider than it needs to: it is
   * labelled with the commit, and everything already uncommitted at that moment
   * reads as changed since. Record on a clean tree for a sharp answer.
   */
  const base = coverage.commit ?? git('merge-base', ref, 'HEAD').trim();

  const byStem = new Map();
  for (const module of coverage.modules) {
    const stem = stemOf(module.file);
    byStem.set(stem, [...(byStem.get(stem) ?? []), module.file]);
  }

  const lines = (text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

  const untracked = new Set(lines(git('ls-files', '--others', '--exclude-standard')));
  // Renames are read as a deletion and an addition, which is what they are to a
  // module's identity: the old path's regions are gone and the new path has none.
  const changed = [...lines(git('diff', '--name-only', '--no-renames', base)), ...untracked];

  const consequential = changed.filter((path) => !isInert(path));
  if (consequential.length === 0) {
    say(
      changed.length === 0
        ? `test:since: nothing has changed since ${base.slice(0, 12)}.`
        : `test:since: ${changed.length} changed path(s), none of which the suite can open.`,
      '  Nothing to run. `yarn test` is still the gate.',
    );
    return 0;
  }

  const suite = suiteFiles();
  const touched = consequential.filter((path) => isTest(path));
  const product = consequential.filter((path) => !isTest(path));

  // An untracked file has no diff of its own, and the graph may still know who
  // imports it, so it is asked about as the addition it is.
  const diff = [
    git('diff', '--no-renames', base),
    ...product.filter((path) => untracked.has(path)).map(diffOfNew),
  ].join('\n');
  const { relations, enumerated } = await importGraph(snapshotFile);
  const { narrowing, distances } = await distanceByExecution(
    snapshotFile,
    inSnapshotCoordinates(diff, byStem),
    {
      relations,
      enumerated,
      knownAs: (file) => byStem.get(stemOf(file)) ?? [file],
      faces: indexFaces(relations),
    },
  );
  const whole = new Set(narrowing.whole);
  const entered = new Set(narrowing.entered);
  const because = new Map(narrowing.because.map((cause) => [cause.test, cause]));

  /**
   * Why this run cannot be narrowed, if it cannot.
   *
   * A changed path the snapshot holds nothing about — no row, or a row saying
   * the build never read this module — and which the graph holds no importer
   * for either arrives as `unread`.
   */
  const unmeasured = narrowing.unread.filter((path) => !isInert(path) && !isTest(path));

  const widen = (because) => {
    say(`test:since: running the whole suite — ${because}.`, `  ${suite.length} files`, '');
    if (dryRun) return 0;
    const result = spawnSync('yarn', ['vitest', 'run'], { cwd: ROOT, stdio: 'inherit' });
    return result.status ?? 1;
  };

  if (unmeasured.length > 0) {
    const [first, ...rest] = [...new Set(unmeasured)].sort();
    return widen(
      `the snapshot has no measurement of ${first}${rest.length === 0 ? '' : ` and ${rest.length} other path(s)`}, ` +
        'so it cannot say who entered it',
    );
  }

  const known = suite.filter((file) => whole.has(file));
  if (known.length === 0) {
    return widen('the snapshot holds no whole observation of any file this suite collects');
  }

  // The rule from `unenteredSubjects`: skip only what the snapshot saw whole and
  // which entered nothing that changed. A file it never saw runs — a new test, a
  // test that was skipped when the snapshot was taken, a file whose observation was
  // an upper bound. And a changed test file is its own answer.
  const selected = suite.filter(
    (file) => !whole.has(file) || entered.has(file) || touched.includes(file),
  );

  const why = (file) => {
    const cause = because.get(file);
    if (cause !== undefined) return explain(cause);
    if (touched.includes(file)) return 'changed';
    return 'no whole observation';
  };

  // A selected file the reading never placed is still selected, and the band it
  // belongs to is the one nobody could measure — never the nearest. `distances`
  // speaks only for what a change reached; the rest of `selected` is here
  // because the snapshot could not speak for it at all, which is a different
  // sentence and the same band.
  const placed = new Map(distances.map((distance) => [distance.test, distance]));
  const reading = selected.map((file) => placed.get(file) ?? { test: file });
  const bands = bandsOf(reading);
  const range = band === undefined ? { from: 1, to: bands.length } : bandRange(band);
  if (range === undefined) {
    say(
      `test:since: \`--band ${band ?? ''}\` is not a range. Write \`1\`, \`1-3\`, or \`3-\`.`,
      `  ${bands.length} band(s) were measured.`,
    );
    return 1;
  }

  const running = slice(bands, range.from, range.to);
  const left = tail(bands, range.from, range.to);
  const width = Math.max(...running.slice(0, 25).map((file) => file.length), 0);
  const at = (file) => {
    const position = bands.findIndex((ring) => ring.tests.includes(file));
    const ring = bands[position];
    return ring === undefined || ring.unplaced ? '  ·' : `${`${position + 1}`.padStart(3)}`;
  };

  say(
    `test:since: ${selected.length} of ${suite.length} files, in ${bands.length} band(s).`,
    `  base     ${base.slice(0, 12)}${ref === undefined ? ' — where the snapshot was recorded' : ' — merged with HEAD'}`,
    `  changed  ${changed.length} path(s): ${product.length} measured, ${touched.length} test file(s), ${changed.length - consequential.length} the suite cannot open`,
    `  skipped  ${suite.length - selected.length} file(s) the snapshot saw whole and which entered none of it`,
    '',
    ...bandLines(bands),
    '',
    ...(band === undefined
      ? []
      : [
          `  band ${range.from}${range.to === range.from ? '' : `-${range.to === Number.MAX_SAFE_INTEGER ? '' : range.to}`}: running ${running.length}, leaving ${left.length} for a later leg.`,
          '  A green band is not a green suite, and `yarn test` is still the gate.',
          '',
        ]),
    ...running.slice(0, 25).map((file) => `  ${at(file)}  ${file.padEnd(width)}  ${why(file)}`),
    ...(running.length > 25 ? [`  … and ${running.length - 25} more`] : []),
    '',
    ...findingLines(reading),
  );

  if (dryRun) return 0;
  if (running.length === 0) {
    // An empty band is not an empty selection. A loop ending on `--band 4-` in a
    // checkout with three bands has finished its legs, and saying that nothing
    // entered the change would be a different and false sentence.
    say(
      band === undefined
        ? '  Nothing entered what changed. `yarn test` is still the gate.'
        : `  No band ${range.from} — the reading has ${bands.length}. Every leg is done; \`yarn test\` is still the gate.`,
    );
    return 0;
  }
  const result = spawnSync('yarn', ['vitest', 'run', ...running], { cwd: ROOT, stdio: 'inherit' });
  if (left.length > 0) {
    say('', `test:since: ${left.length} selected file(s) were not in this band:`, ...left.map((file) => `  ${file}`));
  }
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
