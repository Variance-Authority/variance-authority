/**
 * What a walk's record says of its cases: the scope of its last run, and how a
 * case's kept readings split by outcome. Each is read in-process and by the
 * CLI in a process of its own that opens the record cold.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareOutcomes, type OutcomeComparison } from '../../story/outcomes.js';
import { readingsOf } from '../case-readings.js';
import { caseSectionsAt } from '../case-record.js';
import { BIN, caseOf, cliEnv, indexedByCli, SUBJECT, type Walk } from './carry-contract.js';

const run = promisify(execFile);

/** A reader of how the runs `test`'s case kept split by outcome; absent when one outcome holds none. */
export type Outcomes = (walk: Walk, test: string) => Promise<OutcomeComparison | undefined>;

/** The exact cases the record names as its last run. */
export async function lastCases(walk: Walk): Promise<readonly string[]> {
  // Defer the reader so the fault-injection harness installs its edit-reading mock before the landing loads.
  const { lastCaseRunOf } = await import('../case-landing.js');
  return lastCaseRunOf(caseSectionsAt(walk.coverageFile))!.cases;
}

/** The same scope read by a fresh CLI process, including its before comparison. */
export async function lastCasesByCli(walk: Walk): Promise<readonly string[]> {
  await indexedByCli(walk);
  const { stdout } = await run(process.execPath, [BIN, 'covering', '--file', SUBJECT, '--execution', walk.coverageFile, '--cases', 'last', '--format', 'json'], {
    cwd: walk.root, env: cliEnv(walk), maxBuffer: 64 * 1024 * 1024,
  });
  return (JSON.parse(stdout) as { readonly scope: { readonly tests: readonly string[] } }).scope.tests;
}

/** The readings the record keeps of `test`'s case, against the index beside them. */
export async function outcomes(walk: Walk, test: string): Promise<OutcomeComparison | undefined> {
  const { index, readings } = caseSectionsAt(walk.coverageFile, ['index', 'readings']);
  const read = readings === undefined || index === undefined ? undefined : readingsOf(readings, index, caseOf(test));
  return read === undefined ? undefined : compareOutcomes({ file: test, name: 'runs', readings: read });
}

/** The same comparison asked of `variance story --compare outcome` in a fresh process. */
export async function outcomesByCli(walk: Walk, test: string): Promise<OutcomeComparison | undefined> {
  const { stdout } = await run(process.execPath, [BIN, 'story', '--compare', 'outcome', '--file', test, '--name', 'runs', '--format', 'json'], {
    cwd: walk.root, env: cliEnv(walk), maxBuffer: 64 * 1024 * 1024,
  });
  walk.actions.push({ action: 'compare outcomes through the CLI', test, stdout });
  return (JSON.parse(stdout) as { readonly outcomes: OutcomeComparison }).outcomes;
}
