import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { decodeTestCoverage } from './format.js';
import { coveringTests } from './reverse.js';

// A cache the recording cannot see into answers the next caller without
// running the function it wraps, so that caller is not recorded as a reader of
// the function, nor of anything the function calls. These tests pin where that
// happens; the explanation for users is `docs/selecting.md`, under "What this
// does not reach".

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/memoized-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const memoized = (path: string): string => `${relative(repository, fixture)}/${path}`;
const price = memoized('src/price.ts');
const locale = memoized('src/locale.ts');
// `const whole = …`, inside the function the cache wraps.
const body = 5;
// `return '$';`, which a case mocks.
const symbol = 3;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function record(args: readonly string[], only?: string) {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-memoized-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const output = await execute(
    process.execPath,
    [vitest, 'run', ...args, '--config', resolve(fixture, 'vitest.config.ts')],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        XDG_CACHE_HOME: directory,
        ...(only === undefined ? {} : { VARIANCE_AUTHORITY_FILES: only }),
      },
    },
  ).then(
    ({ stdout, stderr }) => ({ passed: true, text: `${stdout}${stderr}` }),
    (error: { stdout: string; stderr: string }) => ({ passed: false, text: `${error.stdout}${error.stderr}` }),
  );
  const coverage = decodeTestCoverage(await readFile(coverageFile));
  const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
  const readers = (file: string, line: number): readonly string[] =>
    coveringTests(index, { file, line }).map((test) => test.name);
  const blocks = coverage.modules.filter((module) => module.file === price).flatMap((module) => module.blocks);
  // The files credited with the innermost region written across `line`, or
  // with any region of the module when no line is given.
  const files = (line?: number): readonly string[] => {
    if (line === undefined) return [...new Set(blocks.flatMap((block) => block.testFiles))].sort();
    const spanning = blocks.filter((block) => (block.startLine ?? Infinity) <= line && line <= (block.endLine ?? -Infinity));
    const innermost = spanning.reduce((a, b) => ((b.startLine ?? 0) > (a.startLine ?? 0) ? b : a));
    return innermost.testFiles;
  };
  return { output, readers, files };
}

describe('a function behind a cache the recording does not instrument', () => {
  it('is read only by the first case in a file, because the case after it is answered from the cache', async () => {
    const { readers } = await record([]);

    expect(readers(price, body)).toEqual(['computes the price', 'prints the price']);
  }, 20_000);

  it('is read by the second case when it runs alone, which is the journey the record is missing', async () => {
    const { readers } = await record(['-t', 'reads the price again', 'test/cart.case.ts']);

    expect(readers(price, body)).toEqual(['reads the price again']);
  }, 20_000);

  it('is not read at all by a file that runs after another in a shared module graph', async () => {
    // `--no-isolate`: `price.ts` evaluates once, the cache outlives the first
    // file, and the second file calls only the wrapper, which is not source
    // the recording instruments. Nothing in the module is credited to it.
    const { files } = await record(['--no-isolate', '--no-file-parallelism']);

    expect(files()).toEqual([memoized('test/cart.case.ts')]);
  }, 20_000);

  it('is read again by each file that evaluates its own module graph', async () => {
    // Vitest's default: each file evaluates `price.ts` again, so the cache is
    // empty at the start of each file and its first case runs the body.
    const { files } = await record([]);

    expect(files(body)).toEqual([memoized('test/cart.case.ts'), memoized('test/receipt.case.ts')]);
  }, 20_000);
});

describe('a cache filled while a case mocked what the function calls', () => {
  it('answers the next case with the mocked result, which fails it, and neither case is a reader of the mocked function', async () => {
    const { output, readers } = await record([], 'test/checkout.mocked.ts');

    expect(output.passed).toBe(false);
    expect(output.text).toContain("expected '€5.00' to be '$5.00'");
    expect(readers(price, body)).toEqual(['prices in euros']);
    expect(readers(locale, symbol)).toEqual([]);
  }, 20_000);

  it('passes alone, and runs the function the other case mocked', async () => {
    const { output, readers } = await record(['-t', 'prices in dollars'], 'test/checkout.mocked.ts');

    expect(output.passed).toBe(true);
    expect(readers(price, body)).toEqual(['prices in dollars']);
    expect(readers(locale, symbol)).toEqual(['prices in dollars']);
  }, 20_000);
});

it.todo('a case recorded whole and then alone, as case selection runs it, is named unstable on the price body, and the cases the focused run skipped keep their readings — needs the case index to record each module\'s git object name, and the fold to compare a case\'s previous reading before it replaces only the cases it ran (spec 0063)');
