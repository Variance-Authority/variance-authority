#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  narrowByExecution,
  readTestCoverage,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';
import { sourceStem } from './page-side.mjs';

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
 * probes into. Every other changed path is a fact it has no opinion about — a
 * fixture, a manifest, a page-side module that cannot hold a probe, a file added
 * since the recording — and *no row* reads identically to *nobody entered this*
 * while meaning the opposite. So an unmeasured change runs everything and says
 * which path did it. `unenteredSubjects` in
 * `packages/cli/src/commands/journey.ts` is where that rule is argued, over
 * subjects rather than files; this restates it because the CLI does not export
 * it.
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
 * ```
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
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) {
      removed = line.slice(4).replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      flush();
      const named = line.slice(4).replace(/^b\//, '');
      // A deletion writes `+++ /dev/null` and names the file on the line above.
      path = named === '/dev/null' ? removed : named;
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
  const ref = argv.find((argument) => !argument.startsWith('-'));

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
   * A ref is resolved to its merge base first, so a branch behind `main` is not
   * told that everything anybody else merged has changed here — the same reason
   * `packages/cli/src/commands/since.ts` reaches for three dots. With no ref the
   * snapshot names the exact commit it was written at, which needs no resolving.
   *
   * The comparison is against the working tree either way, because uncommitted
   * edits are what the loop before `yarn test` is about. The corollary is that a
   * snapshot recorded over a dirty tree answers wider than it needs to: it is
   * labelled with the commit, and everything already uncommitted at that moment
   * reads as changed since. Record on a clean tree for a sharp answer.
   */
  const base =
    ref === undefined ? coverage.commit : git('merge-base', ref, 'HEAD').trim();

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

  const narrowing = await narrowByExecution(
    snapshotFile,
    inSnapshotCoordinates(git('diff', '--no-renames', base), byStem),
  );
  const whole = new Set(narrowing.whole);
  const entered = new Set(narrowing.entered);

  /**
   * Why this run cannot be narrowed, if it cannot.
   *
   * An untracked file has no diff at all, so nothing above it could have noticed.
   * A tracked one the snapshot holds nothing about — no row, or a row saying the
   * build never read this module — arrives as `unread`.
   */
  const unmeasured = [
    ...product.filter((path) => untracked.has(path)),
    ...narrowing.unread.filter((path) => !isInert(path) && !isTest(path)),
  ];

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

  say(
    `test:since: ${selected.length} of ${suite.length} files.`,
    `  base     ${base.slice(0, 12)}${ref === undefined ? ' — where the snapshot was recorded' : ' — merged with HEAD'}`,
    `  changed  ${changed.length} path(s): ${product.length} measured, ${touched.length} test file(s), ${changed.length - consequential.length} the suite cannot open`,
    `  skipped  ${suite.length - selected.length} file(s) the snapshot saw whole and which entered none of it`,
    '',
    ...selected.slice(0, 25).map((file) => `  ${file}`),
    ...(selected.length > 25 ? [`  … and ${selected.length - 25} more`] : []),
    '',
  );

  if (dryRun) return 0;
  if (selected.length === 0) {
    say('  Nothing entered what changed. `yarn test` is still the gate.');
    return 0;
  }
  const result = spawnSync('yarn', ['vitest', 'run', ...selected], { cwd: ROOT, stdio: 'inherit' });
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
