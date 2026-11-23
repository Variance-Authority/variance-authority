// compass: variance-authority.reach
/**
 * Run a command under the recorder and land what it touched.
 *
 * The recorder sits under the command rather than inside a runtime, so a job is
 * whatever the command starts, in any language. Where nothing can be recorded the
 * command still runs, and its exit is the job's: a job with no record is one
 * selection runs, which is the safe answer to having recorded nothing. A record
 * that cannot be written is an error of its own, after the command has run.
 */

import { execFileSync, spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { holdJob, landJob, type JobStep } from './job-record.js';
import { readJobTrace, TRACED_CALLS, type JobTrace } from './job-trace.js';

/** One command to run as part of a job. */
export interface JobRun {
  /** The repository's root as the kernel spells it, undefined outside a checkout. */
  readonly root: string | undefined;
  readonly cwd: string;
  readonly suite: string;
  readonly run: readonly string[];
  /** An exit besides 0 that still means the command ran whole: a job that reports what it found by its exit. */
  readonly completeOn?: number | undefined;
}

const NOTHING: JobTrace = { reads: new Set(), writes: new Set() };

/**
 * Run `job` under the recorder and answer its exit, undefined when there is no
 * such command. `unrecorded` is told why, when nothing could be.
 */
export async function recordJob(job: JobRun, unrecorded: (why: string) => void): Promise<number | undefined> {
  const { root, cwd, suite, run, completeOn } = job;
  const plainly = (why: string): Promise<number | undefined> => {
    unrecorded(why);
    return started(run[0]!, run.slice(1), cwd);
  };
  if (root === undefined) return plainly('this is not a git checkout');
  const edited = editedFiles(root);
  const scratch = await mkdtemp(join(tmpdir(), 'variance-job-'));
  try {
    const file = join(scratch, 'trace');
    const exit = await started('strace', traced(file, run), cwd);
    // Nothing here can record, as on a laptop: what CI recorded stands, unless a step of this job landed at this commit.
    if (exit === undefined) {
      await holdJob(stepOf(root, suite, false, NOTHING, edited));
      return await plainly('strace is not installed');
    }
    if (!traceWritten(file)) {
      // The recorder could not start the command, which then never ran. Held first:
      // a step that left no trace must not leave the steps before it standing for the whole job.
      await landJob(stepOf(root, suite, false, NOTHING, edited));
      return await plainly('strace could not trace it');
    }
    await landJob(stepOf(root, suite, exit === 0 || exit === completeOn, readJobTrace(linesOf(file)), edited));
    return exit;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * The recorder's arguments. `seccomp-bpf` stops the job only at the calls named,
 * which is what makes a build bearable to trace. A `?` keeps a call this
 * architecture does not have from being refused: arm64 has no `open`.
 */
function traced(file: string, run: readonly string[]): readonly string[] {
  const calls = TRACED_CALLS.map((call) => `?${call}`).join(',');
  return ['-f', '--seccomp-bpf', '-qq', '-y', '-e', 'signal=none', '-o', file, '-e', `trace=${calls}`, '--', ...run];
}

const gitIn = (root: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/** The tracked files that differ from `HEAD`, staged or not. */
function editedFiles(root: string): ReadonlySet<string> {
  return new Set(gitIn(root, 'diff', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean));
}

function stepOf(root: string, suite: string, complete: boolean, trace: JobTrace, edited: ReadonlySet<string>): JobStep {
  const git = (...args: string[]): string => gitIn(root, ...args);
  return { root, suite, commit: git('rev-parse', 'HEAD').trim(), complete, trace, tracked: trackedBlobs(git('ls-files', '-s', '-z')), edited };
}

/** `git ls-files -s -z` as path to blob. */
function trackedBlobs(listing: string): ReadonlyMap<string, string> {
  return new Map(listing.split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    return [entry.slice(tab + 1), entry.split(' ')[1]!];
  }));
}

/** Whether the recorder wrote anything to `file`. Any line at all means it started the command, which must not run twice. */
function traceWritten(file: string): boolean {
  return (statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 0;
}

/** The lines of `file`, a piece at a time: a build's trace outgrows what a string may hold. */
function* linesOf(file: string): Generator<string> {
  const descriptor = openSync(file, 'r');
  try {
    const piece = Buffer.alloc(1 << 20);
    const decoder = new StringDecoder('utf8');
    let rest = '';
    for (let size = readSync(descriptor, piece); size > 0; size = readSync(descriptor, piece)) {
      const lines = (rest + decoder.write(piece.subarray(0, size))).split('\n');
      rest = lines.pop()!;
      yield* lines;
    }
    if (rest !== '') yield rest;
  } finally {
    closeSync(descriptor);
  }
}

/** How long a program stopped at its deadline has to end before it is killed. */
const GRACE = 5_000;

/** How many milliseconds a program may run, and what is told when it is stopped for running longer. */
export interface Deadline {
  readonly after: number;
  readonly stopped: () => void;
}

/** Send `signal` to the child and everything it started: a test runner's workers outlive a signal to the runner alone. */
function signalled(child: ChildProcess, signal: NodeJS.Signals, group: boolean): void {
  if (!group || child.pid === undefined) {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/**
 * The exit of `program`, as a shell states one: a signal is 128 and its number. Undefined when there is no such program. `env`, when given, is its whole environment.
 * `stdio` is where its streams go: this process's own by default. Past its `deadline` the program and every process it started are asked to stop, `stopped` is told, and they are killed when they have not after a grace.
 */
export function started(program: string, args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv, stdio: StdioOptions = 'inherit', deadline?: Deadline): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    // A run with a deadline leads its own process group, so stopping it stops what it started too.
    const group = deadline !== undefined && process.platform !== 'win32';
    const child = spawn(program, args, { cwd, stdio, detached: group, ...(env === undefined ? {} : { env }) });
    const timers: NodeJS.Timeout[] = [];
    let stopped = false;
    if (deadline !== undefined) {
      // A deadline that names a run that never answered, not a wait for one to settle: the run's close is the signal, and these only stop it.
      timers.push(setTimeout(() => {
        stopped = true;
        deadline.stopped();
        signalled(child, 'SIGTERM', group);
        timers.push(setTimeout(() => signalled(child, 'SIGKILL', group), GRACE));
      }, deadline.after));
    }
    const settled = (): void => timers.forEach(clearTimeout);
    child.on('error', (error: NodeJS.ErrnoException) => {
      settled();
      if (error.code === 'ENOENT') resolve(undefined);
      else reject(error);
    });
    child.on('close', (code, signal) => {
      settled();
      // What the stopped run started and left behind goes with it.
      if (stopped) signalled(child, 'SIGKILL', group);
      resolve(code ?? 128 + (signal === null ? 0 : constants.signals[signal]));
    });
  });
}
