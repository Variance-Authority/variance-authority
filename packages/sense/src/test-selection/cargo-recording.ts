// compass: variance-authority.reach
/**
 * Run a Cargo suite one test per process and land which Rust regions each ran.
 *
 * rustc counts the regions (`-C instrument-coverage`), so nothing is placed:
 * the test binaries are built once with the counters in, every test runs alone
 * with its own `LLVM_PROFILE_FILE`, and the addon's `rustCoverage` reads each
 * test's profiles, its own and those of the workspace binaries it started,
 * against the binaries' coverage map onto the Rust reader's regions. A
 * process per test is how libtest's threads are told apart; the journals land
 * through the fold, which cuts each `.rs` file again from the checkout as it
 * cuts a module.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { native } from '../addon.js';
import caseOwner from './case-owner.cjs';
import { finishedCase } from './case-durations.js';
import journalFormat from './journal-format.cjs';
import { whyAbsent } from './native-modules.js';
import { pool } from './pool.js';
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
  /** Its own process's profile first, then those of the processes it started. */
  readonly profiles: readonly string[];
}

/** What the recording build answers. */
interface Build {
  readonly binaries: readonly Binary[];
  /** The workspace's own executables, which a test may start, as `CARGO_BIN_EXE_*` names them. */
  readonly launchable: readonly string[];
  /** What a build script said it reads, by `rerun-if-changed`. */
  readonly read: readonly string[];
}

/**
 * Build `run`'s test binaries instrumented, run each test alone, and fold what
 * each entered into the suite's record. Answers how many tests failed, or
 * undefined when the build did.
 */
export async function recordCargo(run: CargoRun): Promise<number | undefined> {
  const rustCoverage = native()?.rustCoverage;
  if (rustCoverage === undefined) throw new Error(`recording a Cargo suite requires the Sense native addon: ${whyAbsent('rustCoverage')}`);
  const workspace = await metadata(run);
  // The checkout is the workspace's, which `--manifest-path` may place outside the directory Cargo runs in.
  const root = repositoryRoot(workspace.root);
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
    // Every test is built from these and reads none of them, so a change to one selects every row.
    for (const input of workspace.inputs) selection.preconditions.add(input);
    const build = await built(run, workspace, join(profiles, 'build-%p.profraw'));
    if (build === undefined) return undefined;
    for (const input of build.read) if (!relative(root, input).startsWith('..')) selection.preconditions.add(input);
    const finished = [];
    let failed = 0;
    for (const [testFile, sharing] of byTestFile(build.binaries)) {
      const ran: Ran[] = [];
      let unlisted = false;
      for (const binary of sharing) {
        const names = await listed(binary, join(profiles, 'listing-%p.profraw'));
        if (names === undefined) {
          // A target with its own `main` answers no listing: it runs once as `cargo test` runs it, and what it entered is not known.
          unlisted = true;
          if (!(await whole(binary, join(profiles, 'whole-%p.profraw')))) failed += 1;
          continue;
        }
        const tests: Ran[] = [];
        await pool(availableParallelism(), names, async (name, at) => {
          tests[at] = await alone(binary, name, join(profiles, randomUUID()));
        });
        ran.push(...tests);
      }
      const executables = [...sharing.map((binary) => binary.executable), ...build.launchable];
      const entered = rustCoverage(executables, ran.map((test) => [...test.profiles]), root);
      writeJournals(selection, testFile, ran, entered);
      failed += ran.filter((test) => !test.passed).length;
      finished.push({
        filepath: testFile,
        // A test that passed without writing its profile, as one that calls `_exit` does, entered what nobody can tell.
        complete: !unlisted && ran.every((test, at) => test.passed && entered[at] !== null),
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
async function built(run: CargoRun, workspace: Workspace, profile: string): Promise<Build | undefined> {
  const target = join(workspace.target, 'variance');
  const own = process.env['RUSTC_WORKSPACE_WRAPPER'];
  if (own !== undefined && own !== '') process.stderr.write(`variance cargo: the recording build replaces RUSTC_WORKSPACE_WRAPPER (${own}) with its own, which adds -C instrument-coverage.\n`);
  const { code, stdout } = await output('cargo', ['test', '--no-run', '--message-format=json', ...(run.args ?? [])], run.cwd, {
    ...process.env,
    RUSTC_WORKSPACE_WRAPPER: instrumenting(target),
    LLVM_PROFILE_FILE: profile,
    CARGO_TARGET_DIR: target,
  });
  const binaries: Binary[] = [];
  const launchable: string[] = [];
  const read: string[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const message = JSON.parse(line) as {
      reason?: string;
      message?: { rendered?: string };
      executable?: string | null;
      manifest_path?: string;
      profile?: { test?: boolean };
      target?: { kind?: string[]; src_path?: string };
      package_id?: string;
      out_dir?: string;
    };
    // Cargo writes rustc's diagnostics into the JSON it answers, so a failed build would otherwise say only that it failed.
    if (message.reason === 'compiler-message' && code !== 0) process.stderr.write(message.message?.rendered ?? '');
    if (message.reason === 'build-script-executed' && message.out_dir !== undefined) {
      const crate = workspace.packages.get(message.package_id ?? '');
      if (crate !== undefined) read.push(...rerunIfChanged(message.out_dir, crate));
    }
    if (message.reason !== 'compiler-artifact' || typeof message.executable !== 'string') continue;
    if (message.profile?.test !== true) {
      if (message.target?.kind?.includes('bin') === true) launchable.push(message.executable);
      continue;
    }
    if (message.target?.src_path === undefined || message.manifest_path === undefined) continue;
    binaries.push({ executable: message.executable, testFile: message.target.src_path, cwd: dirname(message.manifest_path) });
  }
  return code === 0 ? { binaries, launchable, read } : undefined;
}

/**
 * The files a build script said it reads, from what it printed, which Cargo
 * keeps beside its `OUT_DIR`: `output` in the long-standing layout, and
 * `run/stdout` in the one that groups a package's builds. A path is the
 * package's, unless absolute, and a directory stands for every file under it,
 * as Cargo watches it.
 */
function rerunIfChanged(outDir: string, crate: string): string[] {
  const at = dirname(outDir);
  const said = [join(at, 'output'), join(at, 'run', 'stdout')].find((path) => existsSync(path));
  if (said === undefined) return [];
  const files: string[] = [];
  for (const line of readFileSync(said, 'utf8').split('\n')) {
    const named = /^cargo::?rerun-if-changed=(.+)$/.exec(line.trim())?.[1];
    if (named === undefined) continue;
    const path = isAbsolute(named) ? named : resolve(crate, named);
    if (!existsSync(path)) continue;
    if (!statSync(path).isDirectory()) files.push(path);
    else for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
  }
  return files;
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

/**
 * Cargo's own answer to where the workspace is, where it builds, a workspace's target directory or
 * `CARGO_TARGET_DIR`, and what the build reads beside the sources: the
 * manifests, the lockfile and the build scripts. Asked of the manifest the
 * recorded `cargo test` is given, when it is given one.
 */
async function metadata(run: CargoRun): Promise<Workspace> {
  const { code, stdout } = await output('cargo', ['metadata', '--format-version', '1', '--no-deps', ...manifestOf(run.args ?? [])], run.cwd);
  if (code !== 0) throw new Error(`\`cargo metadata\` failed in ${run.cwd}`);
  const answer = JSON.parse(stdout) as {
    target_directory: string;
    workspace_root: string;
    packages: { id: string; manifest_path: string; targets: { kind: string[]; src_path: string }[] }[];
  };
  const packages = new Map(answer.packages.map((crate) => [crate.id, dirname(crate.manifest_path)]));
  const inputs = new Set([join(answer.workspace_root, 'Cargo.toml'), join(answer.workspace_root, 'Cargo.lock')]);
  for (const crate of answer.packages) {
    inputs.add(crate.manifest_path);
    for (const target of crate.targets) if (target.kind.includes('custom-build')) inputs.add(target.src_path);
  }
  // A workspace that has not been resolved yet has no lockfile.
  return { root: answer.workspace_root, target: answer.target_directory, inputs: [...inputs].filter((input) => existsSync(input)), packages };
}

/** The workspace as `cargo metadata` answers it. */
interface Workspace {
  readonly root: string;
  readonly target: string;
  readonly inputs: readonly string[];
  /** Each package's directory, by the id Cargo's messages name it by. */
  readonly packages: ReadonlyMap<string, string>;
}

/** `--manifest-path` as `cargo test` was given it, for `cargo metadata` to read the same workspace. */
function manifestOf(args: readonly string[]): string[] {
  for (const [at, arg] of args.entries()) {
    if (arg === '--manifest-path' && args[at + 1] !== undefined) return [arg, args[at + 1]!];
    if (arg.startsWith('--manifest-path=')) return [arg];
  }
  return [];
}

function byTestFile(binaries: readonly Binary[]): Map<string, Binary[]> {
  const files = new Map<string, Binary[]>();
  for (const binary of binaries) files.set(binary.testFile, [...files.get(binary.testFile) ?? [], binary]);
  return files;
}

/**
 * The tests a binary declares and `cargo test` runs, as libtest names them:
 * benchmarks are not tests, and an `#[ignore]`d test does not run. Undefined
 * for a binary that is not libtest's, as a harness of its own is: it closes no
 * listing with libtest's count, or refuses the listing.
 * Listing runs the instrumented binary too, so its counters go to `profile`,
 * which nothing reads.
 */
async function listed(binary: Binary, profile: string): Promise<string[] | undefined> {
  const names = async (only: readonly string[]): Promise<string[] | undefined> => {
    const { code, stdout } = await output(binary.executable, ['--list', ...only], binary.cwd, running(binary, profile));
    if (code !== 0 || !/^\d+ tests?, \d+ benchmarks?$/m.test(stdout)) return undefined;
    return stdout.split('\n').flatMap((line) => (line.endsWith(': test') ? [line.slice(0, -': test'.length)] : []));
  };
  const all = await names([]);
  if (all === undefined || all.length === 0) return all;
  const skipped = new Set(await names(['--ignored']));
  return all.filter((name) => !skipped.has(name));
}

/** A binary run once with no arguments, as `cargo test` runs it: whether it passed. */
async function whole(binary: Binary, profile: string): Promise<boolean> {
  const { code, stdout } = await output(binary.executable, [], binary.cwd, running(binary, profile));
  if (code !== 0) process.stderr.write(stdout);
  return code === 0;
}

/**
 * One test, alone in its process, its counters written to `directory` by
 * process id, so a process it starts, which inherits where to write them,
 * writes its own beside them.
 */
async function alone(binary: Binary, name: string, directory: string): Promise<Ran> {
  mkdirSync(directory);
  const began = performance.now();
  const { code, stdout, pid } = await output(binary.executable, ['--exact', name, '--test-threads', '1'], binary.cwd, running(binary, join(directory, '%p.profraw')));
  const passed = code === 0;
  if (!passed) process.stderr.write(stdout);
  const own = join(directory, `${pid}.profraw`);
  const started = readdirSync(directory).map((file) => join(directory, file)).filter((file) => file !== own);
  return { name, passed, duration: performance.now() - began, profiles: [own, ...started] };
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
  entered: readonly (readonly { readonly id: string; readonly ordinals: Uint32Array }[] | null)[],
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

/** A process's exit and its standard output; its standard error goes to ours. */
function output(program: string, args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; pid: number | undefined }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], ...(env === undefined ? {} : { env }) });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString('utf8'), pid: child.pid }));
  });
}
