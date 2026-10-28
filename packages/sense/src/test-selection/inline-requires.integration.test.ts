import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { scanRelations } from '../scan.js';
import { decodeExecutionIndex } from './execution-format.js';
import { coveringTests, ranWhileLoading, type ExecutionIndex } from './reverse.js';

/**
 * Inline requires move a module's evaluation from the test file's load into
 * the first case that reads one of its bindings. Everything the module runs as
 * it evaluates — a higher-order function wrapping a component, a factory
 * building a selector — then runs inside that case, and only that case: the
 * module evaluates once per file, and the cases after it read the cached
 * exports.
 *
 * The record does not move with it. What ran while a module evaluated is the
 * file's, wherever the runner put it, and the case that evaluated it keeps what
 * it entered afterwards as its own, as it would had the file loaded it first.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/jest-inline-requires');
const within = relative(repository, fixture);
const at = (path: string): string => `${within}/${path}`;
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const withLogging = at('src/with-logging.ts');
const testFile = at('test/greet.case.ts');
const temporary: string[] = [];

async function record(inline: boolean): Promise<ExecutionIndex> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-inline-requires-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'], {
    cwd: fixture,
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_INLINE_REQUIRES: inline ? '1' : '0',
    },
  });
  return decodeExecutionIndex(await readFile(coverageFile));
}

/** Per region, who entered it: each case by name, and whether it entered while the module evaluated. */
function readings(index: ExecutionIndex): Record<string, readonly string[]> {
  return Object.fromEntries(index.modules.flatMap((module) => module.blocks.map((block) => [
    `${module.file}:${block.startLine}-${block.endLine} ${block.kind} ${block.name}${block.loaded === true ? ' (loaded)' : ''}`,
    block.crossings.map((crossing) => `${index.tests[crossing.test]!.name}${crossing.loaded === true ? ' (loaded)' : ''}`).sort(),
  ])));
}

let eager: ExecutionIndex;
let inline: ExecutionIndex;

beforeAll(async () => {
  // The fixture's first case asserts where `greet.ts` evaluated, so a run whose
  // transform did not defer the import fails here rather than passing vacuously.
  [eager, inline] = await Promise.all([record(false), record(true)]);
}, 120_000);

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('a module evaluated inside a case by an inline require', () => {
  // `const prefix = …`: runs once, when `greet.ts` evaluates and wraps `greet`.
  const wrapping = { file: withLogging, line: 2 };
  // `return (name) => …`: what each greeting case calls.
  const wrapped = { file: withLogging, line: 3 };
  const cases = [`${testFile} > greets again`, `${testFile} > greets first`, `${testFile} > greets nobody`];
  const covering = (index: ExecutionIndex, at: { file: string; line: number }, options = {}): string[] =>
    coveringTests(index, at, options).map((test) => test.id).sort();

  it('is recorded as an eager load records it', () => {
    expect(readings(inline)).toEqual(readings(eager));
    expect(ranWhileLoading(inline, wrapping)).toBe(true);
  });

  it('names every case that ran, the one that crossed nothing included', () => {
    for (const index of [eager, inline]) expect(index.tests.map((test) => test.id).sort()).toEqual(cases);
  });

  it('charges a change to what ran while the module evaluated to the cases that called it, and through the file graph to every case of the file', async () => {
    const relations = relationsOfFiles(await scanRelations({ root: repository, dirs: [within], digests: false }));

    for (const index of [eager, inline]) {
      expect(covering(index, wrapping)).toEqual(cases.slice(0, 2));
      expect(covering(index, wrapping, { relations })).toEqual(cases);
    }
  });

  it('charges a change to what a case called after the module evaluated to the cases that called it', () => {
    for (const index of [eager, inline]) expect(covering(index, wrapped)).toEqual(cases.slice(0, 2));
  });
});
