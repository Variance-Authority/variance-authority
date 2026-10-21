/**
 * `variance covering --file <path> --checked -- <command>`: which regions of a
 * file the cases that entered them would notice gone.
 *
 * A case that entered a region ran it; whether it checked what the region did
 * is a second question, and the record cannot answer it. A run can: the
 * command runs once as written, then once per region the cases entered, with
 * that region skipped (`VARIANCE_AUTHORITY_FAULT`). Each faulted run runs the
 * cases the plain run's record says entered the region and no other — the
 * seam selects them — so a region costs its own cases, not the suite. A run
 * that goes red, or never finishes, noticed the region gone; one that stays
 * green passes whatever the region does.
 *
 * Every run records into a cache of its own, made here and removed after: the
 * plain run's record is copied into each faulted run's, which is where the seam
 * reads its selection from, and a faulted record never reaches the checkout's.
 */

// compass: variance-authority.reach

import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { ExecutionBlock, ExecutionIndex } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { CoveringAt } from '../covering-args.js';
import { readExecutionIndex } from './execution-input.js';
import { enteredRegion } from './select-fault.js';

/** How one run of the command ended. */
export interface Ran {
  /** Its exit code; `null` when a signal ended it. */
  readonly exit: number | null;
  /** Whether it was stopped at the limit rather than finishing. */
  readonly hung: boolean;
  readonly ms: number;
}

/** Run the command with `env` added, stopping it after `limit` milliseconds when one is given. */
export type Runner = (env: Readonly<Record<string, string | undefined>>, limit?: number) => Promise<Ran>;

/** What a run with the region skipped did: went red, never finished, or passed. */
export type Verdict = 'noticed' | 'hung' | 'passed';

/** One region the cases entered, and what their run did without it. */
export interface CheckedRegion {
  readonly ordinal: number;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** The test files whose cases entered it. */
  readonly witnesses: number;
  readonly verdict: Verdict;
}

export interface CheckedAnswer {
  readonly file: string;
  readonly regions: readonly CheckedRegion[];
  /** Regions with a text of their own that no case entered. */
  readonly unentered: number;
}

/** A region to skip, from the plain run's record. */
export interface Candidate {
  readonly ordinal: number;
  readonly block: ExecutionBlock;
  readonly witnesses: number;
}

/** The asked question, with the command it runs. */
export type CheckedQuestion = CoveringAt & { readonly checked: readonly string[] };

/** The longest a faulted run may take: three plain runs, and never under ten seconds. */
export function hangLimit(plainMs: number): number {
  return Math.max(10_000, 3 * plainMs);
}

/**
 * What a faulted run says about its region, given whether it `read` the file
 * with the region left out. A run that never did — a configuration that does
 * not load, a seam that refused, no case selected — went red or green over
 * something else, and is no verdict.
 */
export function verdictOf(ran: Ran, read: boolean): Verdict {
  if (!read) {
    throw new OperatorError(
      `the run ${ran.hung ? 'stopped at the limit' : `exited ${ran.exit}`} and never read the file with the region left out, so it says nothing about the region`,
    );
  }
  if (ran.hung) return 'hung';
  return ran.exit === 0 ? 'passed' : 'noticed';
}

/**
 * The regions of `file` worth a faulted run: the ones with a text of their
 * own to skip that some case entered, and how many of those had none.
 */
export function candidatesOf(
  index: ExecutionIndex,
  file: string,
  skippable: (ordinal: number) => boolean,
): { readonly candidates: readonly Candidate[]; readonly unentered: number } {
  const rows = index.modules.filter((one) => one.file === file);
  if (rows.length === 0) {
    throw new OperatorError(`the run recorded no region of ${file}: no case it ran loaded the file`);
  }
  const candidates: Candidate[] = [];
  let unentered = 0;
  const regions = Math.max(...rows.map((row) => row.blocks.length));
  for (let ordinal = 0; ordinal < regions; ordinal += 1) {
    const found = enteredRegion(index, file, ordinal);
    if (found === undefined || !skippable(ordinal)) continue;
    if (found.files.size === 0) unentered += 1;
    else candidates.push({ ordinal, block: found.block, witnesses: found.files.size });
  }
  return { candidates, unentered };
}

/** Run the plain command, then the command once per region its cases entered, with that region skipped. */
export async function checkedAnswer(asked: CheckedQuestion, run: Runner = commandRunner(asked.checked, asked.root)): Promise<CheckedAnswer> {
  const { FAULT_VARIABLE, faultReadIn, skippable, testCoverageFile } = await import('@variance-authority/sense/test-selection');
  const caches: string[] = [];
  const cache = async () => {
    const made = await mkdtemp(resolve(tmpdir(), 'variance-checked-'));
    caches.push(made);
    return made;
  };
  try {
    const plainCache = await cache();
    const plain = await run({ VARIANCE_AUTHORITY_CACHE: plainCache, [FAULT_VARIABLE]: undefined });
    if (plain.exit !== 0) {
      throw new OperatorError(`\`${asked.checked.join(' ')}\` did not pass as written (exit ${plain.exit}), so no region it skips can be read against it`);
    }
    const record = testCoverageFile(asked.root, { suite: asked.suite, cacheRoot: plainCache });
    if (!await stat(record).then(() => true, () => false)) {
      throw new OperatorError(
        `\`${asked.checked.join(' ')}\` recorded nothing at ${record}: no seam ran under it, ` +
          'or a cacheRoot the configuration names took the record from VARIANCE_AUTHORITY_CACHE',
      );
    }
    const text = await readFile(resolve(asked.root, asked.file), 'utf8');
    const { candidates, unentered } = candidatesOf(await readExecutionIndex(record), asked.file, (ordinal) => skippable(text, asked.file, ordinal));
    const limit = hangLimit(plain.ms);
    const regions: CheckedRegion[] = [];
    for (const { ordinal, block, witnesses } of candidates) {
      const faultedCache = await cache();
      await cp(plainCache, faultedCache, { recursive: true });
      const address = `${asked.file}#${ordinal}`;
      const ran = await run({ VARIANCE_AUTHORITY_CACHE: faultedCache, [FAULT_VARIABLE]: address }, limit);
      const read = await stat(faultReadIn(faultedCache)).then(() => true, () => false);
      const { name, path, startLine, endLine } = block;
      let verdict: Verdict;
      try {
        verdict = verdictOf(ran, read);
      } catch (error) {
        throw new OperatorError(`${FAULT_VARIABLE}=${address}: ${(error as Error).message}; run it with \`${asked.checked.join(' ')}\` to see why`, { cause: error });
      }
      regions.push({ ordinal, name, path, startLine, endLine, witnesses, verdict });
    }
    return { file: asked.file, regions, unentered };
  } finally {
    await Promise.all(caches.map((made) => rm(made, { recursive: true, force: true })));
  }
}

/**
 * The command, spawned in a process group of its own so a hung run is stopped
 * whole: a runner's workers are its children, and stopping the runner alone
 * leaves them holding the terminal. A faulted run fails by design, so only the
 * plain run, which has a limit of none, says why it failed.
 */
export function commandRunner(command: readonly string[], cwd: string): Runner {
  const [program, ...args] = command;
  if (program === undefined) throw new OperatorError('`--checked` runs the command after `--`, and none was given');
  return (added, limit) => new Promise((done, failed) => {
    const env = { ...process.env };
    for (const [name, value] of Object.entries(added)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    const started = performance.now();
    const child = spawn(program, args, { cwd, env, detached: true, stdio: ['ignore', 'ignore', limit === undefined ? 'inherit' : 'ignore'] });
    let hung = false;
    // A deadline, not a wait: a skipped region can leave a loop that never ends,
    // and nothing but the clock says so. Its length is `hangLimit`'s.
    const stop = limit === undefined ? undefined : setTimeout(() => {
      hung = true;
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    }, limit);
    child.once('error', (error) => {
      clearTimeout(stop);
      failed(new OperatorError(`\`${command.join(' ')}\` did not start: ${error.message}`, { cause: error }));
    });
    child.once('exit', (exit) => {
      clearTimeout(stop);
      done({ exit, hung, ms: performance.now() - started });
    });
  });
}

const SAID: Readonly<Record<Verdict, string>> = {
  noticed: 'went red without it',
  hung: 'did not finish without it',
  passed: 'passed without it',
};

export function formatCheckedAnswer(answer: CheckedAnswer, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(answer)}\n`;
  const passing = answer.regions.filter((region) => region.verdict === 'passed').length;
  const lines = [
    `${answer.file}: ${answer.regions.length} region${answer.regions.length === 1 ? '' : 's'} the cases entered; ` +
      `${passing} pass${passing === 1 ? 'es' : ''} whatever ${passing === 1 ? 'it does' : 'they do'}`,
  ];
  for (const region of answer.regions) {
    const at = region.startLine === region.endLine ? `line ${region.startLine}` : `lines ${region.startLine}-${region.endLine}`;
    const named = region.name === '' ? region.path : `${region.name} ${region.path}`;
    lines.push(`  ${at}  ${named}: ${region.witnesses} test file${region.witnesses === 1 ? '' : 's'} entered it, and ${SAID[region.verdict]}`);
  }
  if (answer.unentered > 0) lines.push(`${answer.unentered} region${answer.unentered === 1 ? '' : 's'} no case entered`);
  return `${lines.join('\n')}\n`;
}
