/**
 * Jest's transform cache, filled before a selected run's workers start, with
 * what its tests load late.
 *
 * A module a test requires inside a case or a hook, as SWC's `module.lazy` or a
 * `require` in a body does, is transformed there on a cold cache, on the case's
 * time; one required at import is transformed before any case and costs none.
 * The record names, per test, the files it loaded only after its first case, so
 * the sequencer's `sort`, which Jest awaits before its global setup and workers,
 * transforms those through Jest's own transformer across `maxWorkers`. Nothing
 * here decides what a test runs. Vitest is not warmed: Vite transforms in one
 * main thread, and a warm-up made TanStack's suite slower, 16.0 s to 16.7 s
 * (issue #1402). Rstest is not: 0.12.6 was measured compiling nothing in a case.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { jestDependency } from './jest-dependency.js';
import { lateLoads } from './recorded-loads.js';
import type { SuiteTimes } from './suite-selection.js';

/** The module each `jest-worker` child loads. */
const WARMING_WORKER = fileURLToPath(new URL('./jest-prewarm-worker.cjs', import.meta.url));

/** How many calls each worker is handed, so one slow file does not hold the rest. */
const CALLS_PER_WORKER = 4;

/** The part of a Jest test the warm-up reads. */
interface Test {
  readonly path: string;
  readonly context: { readonly config: { readonly extensionsToTreatAsEsm?: readonly string[] } };
}

interface GlobalConfig {
  readonly maxWorkers?: number;
  readonly workerThreads?: boolean;
  readonly rootDir?: string;
  readonly collectCoverage?: boolean;
  readonly collectCoverageFrom?: readonly string[];
  readonly coverageProvider?: string;
  readonly onlyChanged?: boolean;
  readonly listTests?: boolean;
  readonly collectTests?: boolean;
}

interface Pool {
  readonly warm: (warming: object) => Promise<number>;
  getStdout(): NodeJS.ReadableStream | null;
  getStderr(): NodeJS.ReadableStream | null;
  end(): Promise<unknown>;
}

export interface WarmingOptions {
  /** The checkout the record names its files from. */
  readonly root: string;
  /** The configuration's `rootDir`, which Jest's packages are resolved from. */
  readonly rootDir: string;
  /** The record this run reads, located as its shards locate it. */
  readonly record: () => Promise<SuiteTimes>;
  readonly say?: (line: string) => void;
}

/**
 * Transform, into Jest's cache, every file the record says one of `tests`
 * loaded late, before Jest starts a worker; with none, start no worker and say
 * nothing. An ES module project, an `.mjs` test and coverage over only the
 * changed files take options the copied CommonJS ones are not, and are left to
 * Jest. Never rejects: a warm-up that could not run says so and leaves the run
 * as it was.
 */
export async function warmRecorded(tests: readonly Test[], globalConfig: GlobalConfig, options: WarmingOptions): Promise<void> {
  // A run that lists or collects its tests transforms none of them.
  if (globalConfig.listTests === true || globalConfig.collectTests === true) return;
  // Jest resolves `--changedSince`, `--lastCommit` and `--changedFilesWithAncestor` to
  // `onlyChanged`, and then hands each runtime the changed files as coverage options.
  if (globalConfig.collectCoverage === true && globalConfig.onlyChanged === true) return;
  const say = options.say ?? ((line: string) => process.stderr.write(`${line}\n`));
  try {
    const commonjs = tests.filter((test) => (test.context.config.extensionsToTreatAsEsm ?? []).length === 0 && !test.path.endsWith('.mjs'));
    if (commonjs.length === 0) return;
    const record = await options.record();
    if (!('times' in record)) return;
    const late = lateLoads(record.recording, options.root, commonjs.map((test) => test.path));
    const projects = new Map<object, Set<string>>();
    for (const test of commonjs) {
      const files = late.get(test.path);
      if (files === undefined) continue;
      const project = projects.get(test.context.config) ?? new Set<string>();
      for (const file of files) project.add(file);
      projects.set(test.context.config, project);
    }
    const warmings = [...projects].map(([config, files]) => ({ config, files: [...files] }));
    const total = warmings.reduce((sum, { files }) => sum + files.length, 0);
    if (total === 0) return;
    const workers = Math.max(1, Math.min(globalConfig.maxWorkers ?? 1, total));
    const size = Math.ceil(total / (workers * CALLS_PER_WORKER));
    const runner = jestDependency(options.rootDir, 'jest-runner');
    // The @jest/transform whose ScriptTransformer jest-runner hands each test's runtime.
    const transform = createRequire(runner).resolve('@jest/transform');
    const resolver = createRequire(runner).resolve('jest-resolve');
    // The coverage options jest-runner hands jest-runtime, less the changed files, which no warmed run has.
    const coverage = {
      collectCoverage: globalConfig.collectCoverage ?? false,
      collectCoverageFrom: globalConfig.collectCoverageFrom ?? [],
      coverageProvider: globalConfig.coverageProvider ?? 'babel',
      globalRootDir: globalConfig.rootDir,
    };
    const pool = workerPool(runner, workers, globalConfig.workerThreads === true);
    try {
      const calls = warmings.flatMap(({ config, files }) => chunks(files, size).map((part) =>
        pool.warm({ transform, resolve: resolver, config, coverage, files: part })));
      const warmed = (await Promise.all(calls)).reduce((sum, count) => sum + count, 0);
      say(`variance-authority: transformed ${warmed} files the selected tests load inside a case, before the workers start`);
    } finally {
      await pool.end();
    }
  } catch (error) {
    // Nothing was warmed, or not all of it: Jest transforms the rest where a test loads it.
    say(`variance-authority: the warm-up stopped, and Jest transforms what it left: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * A `jest-worker` pool over the warming module, made as jest-runner makes its
 * own: the same jest-worker, resolved from it, and the same fork options, so a
 * configuration crosses to a child exactly as it crosses to a test worker.
 */
function workerPool(runner: string, workers: number, threads: boolean): Pool {
  // No import names the adopter's copy: it is the one their runner forks with.
  const { Worker } = createRequire(runner)('jest-worker') as {
    Worker: new (path: string, options: object) => Pool;
  };
  const pool = new Worker(WARMING_WORKER, {
    enableWorkerThreads: threads,
    exposedMethods: ['warm'],
    forkOptions: { serialization: 'json', stdio: 'pipe' },
    maxRetries: 0,
    numWorkers: workers,
  });
  pool.getStdout()?.pipe(process.stdout);
  pool.getStderr()?.pipe(process.stderr);
  return pool;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size));
  return parts;
}
