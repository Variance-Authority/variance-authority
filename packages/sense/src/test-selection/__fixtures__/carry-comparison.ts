/**
 * The comparison of a walk's record with one it kept earlier, as the coverage
 * comparison reads it: how many regions no case runs now, how many no run
 * since measured, and which regions each test file no longer runs.
 *
 * A record carried through an edit keeps a test's cases only where the edit's
 * reading spares them. Where it does not, the test's absence was never
 * measured, so a comparison that says the test no longer runs the region
 * prints ambiguity as a measurement.
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { caseSectionsAt } from '../case-record.js';
import { readCommitRuns } from '../commit-runs.js';
import { coverageChange, type SuiteChange } from '../coverage-count.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { hunksByFile } from '../placed.js';
import type { ExecutionIndex } from '../reverse.js';
import { standsAt } from '../stands.js';
import { BIN, cliEnv, ELSEWHERE_TEST, namer, type Walk } from './carry-contract.js';

const run = promisify(execFile);

/** A record the walk kept, and the commit it was recorded at. */
export interface Kept {
  readonly file: string;
  readonly commit: string;
}

/** Copies the walk's record aside, so a later run cannot change it. */
export async function keepRecord(walk: Walk, name: string): Promise<Kept> {
  const file = resolve(walk.scratch, `${name}.bin`);
  await copyFile(walk.coverageFile, file);
  const commit = walk.head;
  walk.actions.push({ action: 'keep the record', name, commit });
  return { file, commit };
}

/** What a comparison says of the subject's regions. */
export interface Compared {
  /** How many regions it says no case runs now, lost or hidden. */
  readonly lost: number;
  /** How many regions run at the base it says no run since measured. */
  readonly unmeasured: number;
  /** Per test file, the regions it says the file no longer runs, by the label each stands for at HEAD. */
  readonly left: Readonly<Record<string, readonly string[]>>;
}

/** A reader of the comparison of the walk's record with `base`. */
export type Compare = (walk: Walk, base: Kept) => Promise<Compared>;

/** The comparison in-process, through the public readers: the case indexes, the diff and the runs record. */
export async function comparedInProcess(walk: Walk, base: Kept): Promise<Compared> {
  const indexOf = (file: string): ExecutionIndex => decodeExecutionIndex(caseSectionsAt(file).index!);
  const diff = hunksByFile((await run('git', ['diff', '-U0', '--no-color', base.commit], { cwd: walk.root })).stdout);
  const runs = await readCommitRuns(walk.coverageFile);
  const reading = standsAt(walk.coverageFile, runs, gitIn(walk.root), (test) => existsSync(resolve(walk.root, test)));
  const change = coverageChange(indexOf(base.file), indexOf(walk.coverageFile), { diff, stands: reading?.stands ?? [] });
  const named = namer(walk);
  const answer: Compared = {
    lost: change.lost + change.hidden,
    unmeasured: change.unmeasured,
    left: Object.fromEntries(change.testFiles
      .filter((file) => file.left.length > 0 && file.file !== ELSEWHERE_TEST)
      .map((file) => [file.file, file.left.map(named)])),
  };
  walk.actions.push({ action: 'compare', base, answer });
  return answer;
}

/** {@link comparedInProcess}, asked of `variance coverage --against` in a process of its own. */
export async function comparedByCli(walk: Walk, base: Kept): Promise<Compared> {
  const { stdout } = await run(process.execPath, [BIN, 'coverage', '--root', walk.root, '--against', base.file, '--format', 'json'], {
    cwd: walk.root,
    env: cliEnv(walk),
    maxBuffer: 64 * 1024 * 1024,
  });
  const [suite] = (JSON.parse(stdout) as { readonly suites: readonly { readonly base: { readonly change: SuiteChange } }[] }).suites;
  const { change } = suite!.base;
  const named = namer(walk);
  const answer: Compared = {
    lost: change.lost + change.hidden,
    unmeasured: change.unmeasured,
    left: Object.fromEntries(change.testFiles
      .filter((file) => file.left.length > 0 && file.file !== ELSEWHERE_TEST)
      .map((file) => [file.file, file.left.map(named)])),
  };
  walk.actions.push({ action: 'compare through the CLI', base, stdout });
  return answer;
}

/** A synchronous git in `root`, as `standsAt` asks. */
function gitIn(root: string): (...args: string[]) => string {
  return (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}
