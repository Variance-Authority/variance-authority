import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { decodeTestCoverage } from './format.js';
import type { CoverageModule } from './index.js';

/**
 * The probes go into the text the author wrote, ahead of every compiler. In
 * `raw-first-vitest`, esbuild strips TypeScript-only syntax, runs legacy
 * decorators and compiles JSX with `jsxDev`, the jsx-source runtime records
 * where each element was written, and a React Refresh-style plugin appends
 * component registrations. A compiler the project declared `enforce: 'pre'`
 * writes a line above the author's first, and the probes still go in ahead of
 * it. The cases assert the compiled code behaves, that
 * each element carries the line the author wrote it on, and that the
 * registration and the compiler ran; this file asserts the record.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/raw-first-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;

let directory: string;
let modules: readonly CoverageModule[];

/** The regions of `file` some test entered, by name, with their lines and the tests. */
const entered = (file: string): readonly (readonly unknown[])[] | undefined =>
  modules
    .find((module) => module.file === named(file))
    ?.blocks.map((block) => [block.name, block.startLine, block.endLine, block.testFiles]);

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-raw-first-'));
  const coverageFile = resolve(directory, 'coverage.bin');
  // The cases failing fails this run, so the compiled code and the jsx-source lines are checked here too.
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  modules = decodeTestCoverage(await readFile(coverageFile)).modules;
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a module with TypeScript-only syntax, probed before esbuild compiles it', () => {
  it('records each function the author wrote, on the lines the author wrote it', () => {
    const syntax = [named('test/syntax.case.ts')];
    expect(entered('src/syntax.ts')).toEqual([
      ['', 1, 61, syntax],
      ['double', 11, 13, syntax],
      ['sealed', 18, 20, syntax],
      ['logged', 22, 29, syntax],
      ['logged/value', 24, 27, syntax],
      ['Measure/describe', 33, 35, syntax],
      ['Square/constructor', 40, 45, syntax],
      ['Square/area', 48, 50, syntax],
      ['size', 55, 57, syntax],
    ]);
  });
});

describe('a component with probes inside its JSX, compiled and registered after them', () => {
  it('records the function inside a JSX expression on its own line', () => {
    const list = [named('test/list.case.ts')];
    expect(entered('src/list.tsx')).toEqual([
      ['', 1, 11, list],
      ['List', 1, 11, list],
      ['List/map.arg0', 7, 7, list],
    ]);
  });
});

describe('a module a compiler the project declared `enforce: pre` rewrites', () => {
  // `vite-plugin-solid` is one: it compiled every Solid module ahead of a seam
  // appended after it, and the record named each region by a compiled line.
  it('records each function on the line the author wrote it, digested as the file on disk', async () => {
    const compiled = [named('test/compiled.case.ts')];
    expect(entered('src/compiled.ts')).toEqual([
      ['', 1, 7, compiled],
      ['greet', 1, 3, compiled],
      ['shout', 5, 7, compiled],
    ]);
    const disk = await readFile(resolve(fixture, 'src/compiled.ts'), 'utf8');
    expect(modules.find((module) => module.file === named('src/compiled.ts'))?.sourceDigest).toBe(digestString(disk));
  });
});
