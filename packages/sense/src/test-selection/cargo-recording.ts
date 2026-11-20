// compass: variance-authority.reach
/**
 * Run a Cargo suite one test per process and land which Rust regions each ran.
 *
 * rustc counts the regions (`-C instrument-coverage`), so nothing is placed:
 * the test binaries are built once with the counters in, every test runs alone
 * with its own `LLVM_PROFILE_FILE`, and the addon's `rustCoverage` reads each
 * profile against the binaries' coverage map onto the Rust reader's regions. A
 * process per test is how libtest's threads are told apart; the journals land
 * through the fold, which cuts each `.rs` file again from the checkout as it
 * cuts a module.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { native } from '../addon.js';
import caseOwner from './case-owner.cjs';
import { finishedCase } from './case-durations.js';
import journalFormat from './journal-format.cjs';
import { whyAbsent } from './native-modules.js';
import { recordFileFor } from './record-location.js';
import { repositoryRoot } from './repository-root.js';
import { foldRun } from './selection-fold.js';
import { newRun } from './selection-run.js';

export interface CargoRun {
  /** Where the Cargo command runs. */
  readonly cwd: string;
  readonly suite?: string | undefined;
  /** The record to write, in place of the suite's. */
  readonly coverageFile?: string | undefined;
  /** What follows `cargo test`, before any `--`: the packages, features and targets to build. */
  readonly args?: readonly string[];
}

/** One test binary Cargo built, and the file its tests are declared in. */
interface Binary {
  readonly executable: string;
  readonly testFile: string;
  /** Where Cargo runs it: its package's directory. */
  readonly cwd: string;
}

/** One libtest test as it ran. */
interface Ran {
  readonly name: string;
  readonly passed: boolean;
  readonly duration: number;
  readonly profile: string;
}

/**
 * Build `run`'s test binaries instrumented, run each test alone, and fold what
 * each entered into the suite's record. Answers how many tests failed, or
 * undefined when the build did.
 */
export async function recordCargo(run: CargoRun): Promise<number | undefined> {
  const rustCoverage = native()?.rustCoverage;
  if (rustCoverage === undefined) throw new Error(`recording a Cargo suite requires the Sense native addon: ${whyAbsent('rustCoverage')}`);
  const root = repositoryRoot(resolve(run.cwd));
  const coverageFile = recordFileFor(root, run.cwd, { suite: run.suite, coverageFile: run.coverageFile });
  const selection = newRun(coverageFile, root, 'presence');
  const fold = foldRun(selection, {
    coverageFile,
    shims: [],
    derive: true,
    unreached: 'No Rust file of the checkout was entered: check that the tests run code under the repository root.',
  });
  const profiles = `${selection.runDirectory}-profiles`;
  mkdirSync(profiles, { recursive: true });
  try {
    const binaries = await built(run, join(profiles, 'build-%p.profraw'));
    if (binaries === undefined) return undefined;
    const finished = [];
    let failed = 0;
    for (const [testFile, sharing] of byTestFile(binaries)) {
      const ran: Ran[] = [];
      for (const binary of sharing) {
        const names = await listed(binary, join(profiles, 'listing-%p.profraw'));
        ran.push(...await inParallel(names, (name) => alone(binary, name, join(profiles, `${randomUUID()}.profraw`))));
      }
      const entered = rustCoverage(sharing.map((binary) => binary.executable), ran.map((test) => test.profile), root);
      writeJournals(selection, testFile, ran, entered);
      failed += ran.filter((test) => !test.passed).length;
      finished.push({
        filepath: testFile,
        complete: ran.every((test) => test.passed),
        cases: ran.map((test) => finishedCase(test.name, undefined, test.duration)),
      });
    }
    await fold(finished);
    return failed;
  } finally {
    rmSync(profiles, { recursive: true, force: true });
  }
}

/**
 * The test binaries, built once with rustc's counters in, beside the plain build
 * rather than over it. Only the workspace's crates carry counters: a dependency
 * is never a region, and counting one costs the most in the hottest code, where
 * every thread of a test increments the same counters. Build scripts are
 * instrumented too and run during the build, so their counters go to `profile`,
 * which nothing reads.
 */
async function built(run: CargoRun, profile: string): Promise<Binary[] | undefined> {
  const target = join(await targetDirectory(run.cwd), 'variance');
  const own = process.env['RUSTC_WORKSPACE_WRAPPER'];
  if (own !== undefined && own !== '') process.stderr.write(`variance cargo: the recording build replaces RUSTC_WORKSPACE_WRAPPER (${own}) with its own, which adds -C instrument-coverage.\n`);
  const { code, stdout } = await output('cargo', ['test', '--no-run', '--message-format=json', ...(run.args ?? [])], run.cwd, {
    ...process.env,
    RUSTC_WORKSPACE_WRAPPER: instrumenting(target),
    LLVM_PROFILE_FILE: profile,
    CARGO_TARGET_DIR: target,
  });
  if (code !== 0) return undefined;
  const binaries: Binary[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const message = JSON.parse(line) as {
      reason?: string;
      executable?: string | null;
      manifest_path?: string;
      profile?: { test?: boolean };
      target?: { src_path?: string };
    };
    if (message.reason !== 'compiler-artifact' || message.profile?.test !== true) continue;
    if (typeof message.executable !== 'string' || message.target?.src_path === undefined || message.manifest_path === undefined) continue;
    binaries.push({ executable: message.executable, testFile: message.target.src_path, cwd: dirname(message.manifest_path) });
  }
  return binaries;
}

/**
 * A rustc wrapper that adds `-C instrument-coverage`, which Cargo runs for the
 * workspace's crates alone. It is written once at a fixed path, since Cargo
 * rebuilds what a different wrapper compiled.
 */
function instrumenting(target: string): string {
  const windows = process.platform === 'win32';
  const wrapper = join(target, windows ? 'instrumenting-rustc.cmd' : 'instrumenting-rustc');
  const script = windows ? '@%* -C instrument-coverage\r\n' : '#!/bin/sh\nexec "$@" -C instrument-coverage\n';
  if (!existsSync(wrapper) || readFileSync(wrapper, 'utf8') !== script) {
    mkdirSync(target, { recursive: true });
    writeFileSync(wrapper, script, { mode: 0o755 });
  }
  return wrapper;
}

/** Cargo's own answer to where it builds: a workspace's target directory, or `CARGO_TARGET_DIR`. */
async function targetDirectory(cwd: string): Promise<string> {
  const { code, stdout } = await output('cargo', ['metadata', '--format-version', '1', '--no-deps'], cwd);
  if (code !== 0) throw new Error(`\`cargo metadata\` failed in ${cwd}`);
  return (JSON.parse(stdout) as { target_directory: string }).target_directory;
}

function byTestFile(binaries: readonly Binary[]): Map<string, Binary[]> {
  const files = new Map<string, Binary[]>();
  for (const binary of binaries) files.set(binary.testFile, [...files.get(binary.testFile) ?? [], binary]);
  return files;
}

/**
 * The tests a binary declares and `cargo test` runs, as libtest names them:
 * benchmarks are not tests, and an `#[ignore]`d test does not run. Listing runs
 * the instrumented binary too, so its counters go to `profile`, which nothing reads.
 */
async function listed(binary: Binary, profile: string): Promise<string[]> {
  const [all, ignored] = await Promise.all([[], ['--ignored']].map(async (only) => {
    const { code, stdout } = await output(binary.executable, ['--list', '--format', 'terse', ...only], binary.cwd, running(binary, profile));
    if (code !== 0) throw new Error(`${binary.executable} --list failed`);
    return stdout.split('\n').flatMap((line) => (line.endsWith(': test') ? [line.slice(0, -': test'.length)] : []));
  }));
  const skipped = new Set(ignored);
  return all!.filter((name) => !skipped.has(name));
}

/** One test, alone in its process, its counters written to `profile`. */
async function alone(binary: Binary, name: string, profile: string): Promise<Ran> {
  const began = performance.now();
  const { code, stdout } = await output(binary.executable, ['--exact', name, '--test-threads', '1'], binary.cwd, running(binary, profile));
  const passed = code === 0;
  if (!passed) process.stderr.write(stdout);
  return { name, passed, duration: performance.now() - began, profile };
}

/** What a test process starts with: what `cargo test` gives it, and where its counters go. */
function running(binary: Binary, profile: string): NodeJS.ProcessEnv {
  return { ...process.env, CARGO_MANIFEST_DIR: binary.cwd, LLVM_PROFILE_FILE: profile };
}

/**
 * The frames: the file's journal is the union of its tests, and each test is a
 * case frame of its own.
 */
function writeJournals(
  selection: { readonly runDirectory: string; readonly caseDirectory: string },
  testFile: string,
  ran: readonly Ran[],
  entered: readonly (readonly { readonly id: string; readonly ordinals: Uint32Array }[])[],
): void {
  const stamp = `${process.pid}-${randomUUID()}`;
  const union = new Map<string, Set<number>>();
  const frames = ran.map((test, at) => {
    const modules = new Map<string, Set<number>>();
    for (const { id, ordinals } of entered[at] ?? []) {
      modules.set(id, new Set(ordinals));
      for (const ordinal of ordinals) union.set(id, (union.get(id) ?? new Set()).add(ordinal));
    }
    return journalFormat.encodeJournal(caseOwner.packCase(testFile, test.name, String(at)), counters(modules));
  });
  mkdirSync(selection.runDirectory, { recursive: true });
  writeFileSync(`${selection.runDirectory}/${stamp}.va`, journalFormat.encodeJournal(testFile, counters(union)));
  mkdirSync(selection.caseDirectory, { recursive: true });
  writeFileSync(`${selection.caseDirectory}/${stamp}.vac`, journalFormat.packFrames(frames));
}

/** Ordinals as the counters a journal reads: one at each entered region. */
function counters(modules: ReadonlyMap<string, ReadonlySet<number>>): Map<string, Uint32Array> {
  const out = new Map<string, Uint32Array>();
  for (const [id, ordinals] of modules) {
    const entered = new Uint32Array(Math.max(...ordinals) + 1);
    for (const ordinal of ordinals) entered[ordinal] = 1;
    out.set(id, entered);
  }
  return out;
}

/** Each of `items` through `each`, as many at once as the machine has cores. */
async function inParallel<Item, Result>(items: readonly Item[], each: (item: Item) => Promise<Result>): Promise<Result[]> {
  const results: Result[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++;
      results[at] = await each(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), items.length) }, worker));
  return results;
}

/** A process's exit and its standard output; its standard error goes to ours. */
function output(program: string, args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], ...(env === undefined ? {} : { env }) });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString('utf8') }));
  });
}
