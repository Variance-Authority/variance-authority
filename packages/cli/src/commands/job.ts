// compass: variance-authority.reach
/**
 * `variance job`: run a command and record what it touched.
 *
 * The recorder sits under the command rather than inside a runtime, so a job is
 * whatever the command starts, in any language. Recording never stands between a
 * build and its result: where nothing can be recorded the command still runs, and
 * its exit is the job's either way. A job with no record is one selection runs,
 * which is the safe answer to having recorded nothing.
 */

import { spawn } from 'node:child_process';
import { closeSync, openSync, readSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { jobInputs, landJob, readJobTrace, TRACED_CALLS, type JobTrace } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedJob } from '../job-args.js';
import type { Streams } from './configless.js';
import { gitIn, topLevel } from './since.js';

/** Run `parsed`'s command under the recorder, answering its exit. */
export async function runJob({ suite, run }: ParsedJob, streams: Pick<Streams, 'err'>, cwd = process.cwd()): Promise<number> {
  const top = await topLevel(cwd);
  if (top === undefined) return unrecorded(run, cwd, streams, 'this is not a git checkout');
  const root = await realpath(top);
  const scratch = await mkdtemp(join(tmpdir(), 'variance-job-'));
  try {
    const file = join(scratch, 'trace');
    const exit = await started('strace', traced(file, run), cwd);
    if (exit === undefined) return await untraced(root, suite, run, cwd, streams, 'strace is not installed');
    const trace = readTrace(file);
    // Nothing traced means the recorder could not start the command, which then never ran.
    if (trace === undefined) return await untraced(root, suite, run, cwd, streams, 'strace could not trace it');
    await record(root, suite, exit, trace);
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

async function record(root: string, suite: string, exit: number, trace: JobTrace): Promise<void> {
  const git = gitIn(root);
  await landJob({
    root,
    suite,
    commit: git('rev-parse', 'HEAD').trim(),
    complete: exit === 0,
    at: new Date().toISOString(),
    inputs: jobInputs(trace, root, trackedBlobs(git('ls-files', '-s', '-z')), ignoredBy(git('ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'))),
    trace,
  });
}

/** `git ls-files -s -z` as path to blob. */
function trackedBlobs(listing: string): ReadonlyMap<string, string> {
  return new Map(listing.split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    return [entry.slice(tab + 1), entry.split(' ')[1]!];
  }));
}

/**
 * Which names `git ls-files --others --ignored --directory -z` covers, by the name
 * or a folder above it. A listing, because `git check-ignore` dies on the first
 * name beyond a link and answers for none after it. An ignored name it misses,
 * one nothing on disk matches, stays recorded and can never be in a diff.
 */
function ignoredBy(listing: string): (names: readonly string[]) => ReadonlySet<string> {
  const entries = new Set(listing.split('\0'));
  const covered = (name: string): boolean => {
    if (entries.has(name)) return true;
    for (let slash = name.indexOf('/'); slash !== -1; slash = name.indexOf('/', slash + 1)) {
      if (entries.has(name.slice(0, slash + 1))) return true;
    }
    return false;
  };
  return (names) => new Set(names.filter(covered));
}

/** The trace in `file`, undefined when the recorder traced nothing. */
function readTrace(file: string): JobTrace | undefined {
  let trace: JobTrace;
  try {
    trace = readJobTrace(linesOf(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return trace.reads.size + trace.writes.size + trace.absent.size === 0 ? undefined : trace;
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

/** Run `run` unrecorded and hold the job incomplete: a step that left no trace must not leave the steps before it standing for the whole job. */
async function untraced(root: string, suite: string, run: readonly string[], cwd: string, streams: Pick<Streams, 'err'>, why: string): Promise<number> {
  const exit = await unrecorded(run, cwd, streams, why);
  await record(root, suite, 1, { reads: new Set(), writes: new Set(), absent: new Set() });
  return exit;
}

async function unrecorded(run: readonly string[], cwd: string, streams: Pick<Streams, 'err'>, why: string): Promise<number> {
  streams.err(`Not recorded: ${why}. The command runs, and selection will run this job.\n`);
  const exit = await started(run[0]!, run.slice(1), cwd);
  if (exit === undefined) throw new OperatorError(`\`${run[0]!}\` could not be started: no such command`);
  return exit;
}

/** The exit of `program`, as a shell states one: a signal is 128 and its number. Undefined when there is no such program. */
function started(program: string, args: readonly string[], cwd: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: 'inherit' });
    child.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? resolve(undefined) : reject(error)));
    child.on('close', (code, signal) => resolve(code ?? 128 + (signal === null ? 0 : constants.signals[signal])));
  });
}
