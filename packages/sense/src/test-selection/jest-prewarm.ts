/**
 * Jest's transform cache, filled before a selected run's workers start.
 *
 * Jest transforms a module the first time a test worker requires it. A module
 * a test requires lazily — inside a case or a hook, as SWC's `module.lazy` or a
 * `require` in a body does — is transformed there, on a cold cache, and the
 * test's own time pays for it, again in each worker that loads it. A selected
 * run already holds the record, and the record names the files each test file
 * loaded, so the sequencer's `sort`, which Jest awaits in the main process
 * after every filter and before its global setup and its workers, transforms
 * those files first through Jest's own transformer, in parallel across
 * `maxWorkers`. Every test that requires one then reads it from the cache.
 *
 * Nothing here decides what a test runs. A run with no record, a test the
 * record holds no row for, and a file whose transform fails are left to Jest
 * exactly as they were.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { jestDependency } from './jest-dependency.js';
import { recordedLoads } from './recorded-loads.js';
import type { SuiteTimes } from './suite-selection.js';

/** The module each `jest-worker` child loads. */
const WARMING_WORKER = fileURLToPath(new URL('./jest-prewarm-worker.cjs', import.meta.url));

/** How many calls each worker is handed, so one slow file does not hold the rest. */
const CALLS_PER_WORKER = 4;

/** The part of a Jest test the warm-up reads. */
interface Test {
  readonly path: string;
  readonly context: { readonly config: object };
}

interface GlobalConfig {
  readonly maxWorkers?: number;
  readonly rootDir?: string;
  readonly collectCoverage?: boolean;
  readonly collectCoverageFrom?: readonly string[];
  readonly coverageProvider?: string;
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
 * loaded, before Jest starts a worker. Resolves once they are all in it, and
 * never rejects: a warm-up that could not run leaves the run as Jest runs it.
 */
export async function warmRecorded(tests: readonly Test[], globalConfig: GlobalConfig, options: WarmingOptions): Promise<void> {
  // A run that lists or collects its tests transforms none of them.
  if (tests.length === 0 || globalConfig.listTests === true || globalConfig.collectTests === true) return;
  const say = options.say ?? ((line: string) => process.stderr.write(`${line}\n`));
  try {
    const record = await options.record();
    if (!('times' in record)) return;
    const projects = new Map<object, string[]>();
    for (const test of tests) projects.set(test.context.config, [...(projects.get(test.context.config) ?? []), test.path]);
    const warmings = [...projects].flatMap(([config, paths]) => {
      const files = recordedLoads(record.recording, options.root, paths);
      return files.length === 0 ? [] : [{ config, files }];
    });
    const total = warmings.reduce((sum, { files }) => sum + files.length, 0);
    if (total === 0) return;
    const workers = Math.max(1, Math.min(globalConfig.maxWorkers ?? 1, total));
    const size = Math.ceil(total / (workers * CALLS_PER_WORKER));
    const transform = jestDependency(options.rootDir, '@jest/transform');
    const coverage = {
      collectCoverage: globalConfig.collectCoverage ?? false,
      collectCoverageFrom: globalConfig.collectCoverageFrom ?? [],
      coverageProvider: globalConfig.coverageProvider ?? 'babel',
      globalRootDir: globalConfig.rootDir,
    };
    const pool = workerPool(options.rootDir, workers);
    try {
      const calls = warmings.flatMap(({ config, files }) => chunks(files, size).map((part) =>
        pool.warm({ transform, config, coverage, files: part })));
      const warmed = (await Promise.all(calls)).reduce((sum, count) => sum + count, 0);
      say(`variance-authority: transformed ${warmed} files the record says the selected tests load, before the workers start`);
    } finally {
      await pool.end();
    }
  } catch {
    // Nothing was warmed, or not all of it: Jest transforms the rest where a test loads it.
  }
}

/** A `jest-worker` pool over the warming module, resolved through Jest's runner, which forks its own with it. */
function workerPool(rootDir: string, workers: number): Pool {
  const runner = jestDependency(rootDir, 'jest-runner');
  // The jest-worker the project's runner forks with, resolved from it: no import names the adopter's copy.
  const { Worker } = createRequire(runner)('jest-worker') as {
    Worker: new (path: string, options: object) => Pool;
  };
  const pool = new Worker(WARMING_WORKER, { numWorkers: workers, exposedMethods: ['warm'], maxRetries: 0 });
  pool.getStdout()?.pipe(process.stdout);
  pool.getStderr()?.pipe(process.stderr);
  return pool;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size));
  return parts;
}
