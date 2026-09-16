/**
 * Whether selection is *safe*, run rather than asserted.
 *
 * A selector that returns a short list is easy. A selector that returns a short
 * list containing every test the change would have broken is the only one worth
 * shipping, and the difference between the two is not visible in the list: it
 * is visible when the tests it left out are run anyway.
 *
 * So this breaks something on purpose and checks the answer against reality:
 *
 *   1. Mutate one line of one source file.
 *   2. Ask the snapshot which test files that line can reach.
 *   3. Run the *whole* suite with the mutation in place.
 *   4. Every test file that failed must be in the answer from step 2.
 *
 * A miss here is a test that would have caught a regression and was skipped —
 * the one failure mode that makes selection worse than no selection at all.
 * Restores the file whatever happens, including on a crash.
 *
 *   REPORTS=<dir> node packages/sense/scripts/select-check.mjs <snapshot> <repo> <mutations.json>
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { narrowByExecution, openCoverageFile } from '../dist/test-selection/index.js';

const SNAPSHOT = process.argv[2];
const REPO = resolve(process.argv[3]);
const PLAN = JSON.parse(readFileSync(process.argv[4], 'utf8'));

// Only two facts are wanted from the snapshot here — every test path, and how
// many modules there are — and a full decode to obtain them is the one operation
// in this script that cannot be afforded on a large repository. Read them off the
// columns instead, and let go of the descriptor: the mutation loop's own queries
// open the file again through `askCoverageFile`.
const { allTests, moduleCount } = (() => {
  const held = openCoverageFile(SNAPSHOT);
  try {
    const { view } = held;
    const tests = [];
    for (let row = 0; row < view.testPath.length; row += 1) tests.push(view.string(view.testPath.at(row)));
    return { allTests: tests, moduleCount: view.modulePath.length };
  } finally {
    held.close();
  }
})();
console.log(`snapshot: ${allTests.length} test files, ${moduleCount} modules`);

/** A unified diff for one file, from its text before and after. */
const diffOf = (path, before, after) => {
  const from = before.split('\n');
  const to = after.split('\n');
  let at = 0;
  while (at < from.length && from[at] === to[at]) at += 1;
  const line = at + 1;
  return `--- a/${path}\n+++ b/${path}\n@@ -${line},1 +${line},1 @@\n-${from[at]}\n+${to[at]}`;
};

/**
 * Which test files a run reported as failing, by the snapshot's own names.
 *
 * Read from the JSON reporter's file rather than scraped off the terminal: a
 * regex over a progress display is a second thing that can be wrong, and when it
 * is wrong it parses *nothing* and the harness reports every mutation safe. The
 * JSON report names each file absolutely and carries its status, so the only
 * step left is making the path look like the snapshot's.
 */
const failuresOf = (reportFile) => {
  if (!existsSync(reportFile)) return undefined;
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const results = report.testResults;
  if (!Array.isArray(results)) return undefined;
  const failed = new Set();
  for (const result of results) {
    if (result.status !== 'failed') continue;
    failed.add(relative(REPO, result.name).split('\\').join('/'));
  }
  return failed;
};

const REPORTS = process.env.REPORTS ?? '/tmp';
let missed = 0;
let unreadable = 0;
for (const plan of PLAN) {
  const file = resolve(REPO, plan.file);
  const original = readFileSync(file, 'utf8');
  if (!original.includes(plan.from)) {
    console.log(`\n${plan.file}: SKIPPED — ${JSON.stringify(plan.from)} is not in the file`);
    continue;
  }
  const mutated = original.replace(plan.from, plan.to);
  const path = relative(REPO, file).split('\\').join('/');
  const diff = diffOf(path, original, mutated);

  const narrowing = await narrowByExecution(SNAPSHOT, diff);
  const entered = new Set(narrowing.entered);

  /**
   * What a suite would actually run, which is not `entered`.
   *
   * `entered` is what execution saw. Absence from it is only evidence for a test
   * the snapshot observed *whole* — one that ran every test in the file — because
   * a file that skipped half its tests recorded half its reach, and the half it
   * did not record is indistinguishable from reach it does not have. So the safe
   * set is `entered` plus every test the snapshot is not entitled to speak for,
   * and it is the safe set the miss count below is measured against. Reporting
   * `entered` alone would be reporting a selector nobody should ship.
   */
  const whole = new Set(narrowing.whole);
  const selected = new Set(entered);
  for (const test of allTests) if (!whole.has(test)) selected.add(test);

  console.log(`\n${plan.file}`);
  console.log(`  ${JSON.stringify(plan.from)} -> ${JSON.stringify(plan.to)}`);
  console.log(`  execution says ${entered.size} test files entered the changed region`);
  console.log(`  the snapshot speaks wholly for ${whole.size} of ${allTests.length}; the other ${allTests.length - whole.size} cannot be excluded`);
  console.log(`  so a safe run is ${selected.size} of ${allTests.length} test files (${((selected.size / allTests.length) * 100).toFixed(1)}%)`);
  if (narrowing.unread.length > 0) console.log(`  ${narrowing.unread.length} changed paths nothing recorded holds: ${narrowing.unread.slice(0, 3).join(', ')}`);

  writeFileSync(file, mutated);
  const report = resolve(REPORTS, `${plan.file.split('/').join('-')}.json`);
  rmSync(report, { force: true });
  let output;
  const started = Date.now();
  try {
    const done = spawnSync(process.execPath, [
      'node_modules/vitest/vitest.mjs', 'run', '--config', plan.config ?? 'vitest.plain.mts',
      '--reporter=json', `--outputFile=${report}`, '--no-coverage',
    ], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, VA_COVERAGE: plan.throwaway } });
    output = `${done.stdout}\n${done.stderr}`;
  } finally {
    writeFileSync(file, original);
  }

  const failed = failuresOf(report);
  // An unreadable report is not an empty one. Without this the harness would
  // read a crashed run as "nothing failed" and go on to call the selection safe.
  if (failed === undefined) {
    unreadable += 1;
    console.log(`  NO REPORT — the run produced no readable JSON; ${output.trim().split('\n').slice(-3).join(' | ')}`);
    continue;
  }
  console.log(`  the suite ran in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const missedHere = [...failed].filter((test) => !selected.has(test));
  const missedByExecution = [...failed].filter((test) => !entered.has(test));
  console.log(`  the mutation actually broke ${failed.size} test files`);
  if (failed.size === 0) {
    console.log(`  INERT — nothing failed, so this mutation proves nothing about safety`);
    continue;
  }
  if (missedHere.length === 0) {
    console.log(`  every failing test was selected — safe`);
  } else {
    missed += missedHere.length;
    console.log(`  MISSED ${missedHere.length}: ${missedHere.slice(0, 8).join(', ')}`);
  }
  // Separately, because it is a different fact: a test that failed and did not
  // enter the region is either reached through a path execution did not record,
  // or a test the snapshot never observed whole. The first is a defect in the
  // record; the second is the suite skipping tests, and the safe set covers it.
  const unrecorded = missedByExecution.filter((test) => whole.has(test));
  console.log(`  ${missedByExecution.length} of them never entered the region — ${unrecorded.length} of those in test files the snapshot observed whole`);
  if (unrecorded.length > 0) console.log(`    UNRECORDED REACH: ${unrecorded.slice(0, 8).join(', ')}`);
  const wasted = selected.size - failed.size;
  console.log(`  ${wasted} selected test files did not fail — the price of being safe`);
}

console.log(`\n${missed === 0 ? 'no failing test was ever left out' : `${missed} failing test files were left out — selection is not safe`}`);
if (unreadable > 0) console.log(`${unreadable} mutations produced no readable report and are not evidence either way`);
