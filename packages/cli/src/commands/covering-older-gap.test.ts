import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { updateSourceIndex } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';

/**
 * The gap a record older than the asked file leaves: a new file is run by
 * reach, and selection owns that answer, so the gap runs the recorded test
 * files selection names for it, counts the cases the record holds of them,
 * and names `variance reach --since` from the record's commit, which takes
 * every file added since, the unrecorded tests among them.
 * A suite given to the share with no record fetches the mainline's.
 */

let cache: string;
let previous: string | undefined;
const made: string[] = [];

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-older-gap-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await Promise.all([cache, ...made].map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Two recorded test files, of which only `refund.test.ts` imports a file added since. */
const INDEX = {
  tests: [
    { id: 'r1', file: 'src/refund.test.ts', name: 'refunds once' },
    { id: 'r2', file: 'src/refund.test.ts', name: 'refunds twice' },
    { id: 'p', file: 'src/pay.test.ts', name: 'charges once' },
  ],
  modules: [{
    file: 'src/pay.ts',
    blocks: [{ kind: 'function', name: 'pay', path: 'entry', startLine: 1, endLine: 1, source: true, crossings: [0, 1, 2].map((test) => ({ test, distance: 0 })) }],
  }],
};

/**
 * A checkout whose `unit` record was made, at `recordedAt`, before `src/refund.ts`
 * existed. `refund.test.ts`, which the record ran, imports it, and so does
 * `refund-new.test.ts`, added since and never recorded. `src/credit.ts` only a
 * new test imports, and `src/void.ts` nothing does.
 */
async function checkout(carry?: 'share'): Promise<{ readonly at: string; readonly recordedAt: string }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-older-gap-'));
  made.push(at);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: at, encoding: 'utf8' }).trim();
  const write = async (file: string, text: string) => {
    await mkdir(dirname(join(at, file)), { recursive: true });
    await writeFile(join(at, file), text);
  };
  git('init', '--quiet');
  await write('package.json', '{"name":"older-gap-fixture","private":true}\n');
  await write('variance.config.json', JSON.stringify({ suites: { unit: { kind: 'unit', ...(carry === undefined ? {} : { carry }) } } }));
  await write('src/pay.ts', 'export const pay = 1;\n');
  await write('src/pay.test.ts', "import { pay } from './pay';\nexport const paid = pay;\n");
  git('add', '.');
  git('commit', '--quiet', '-m', 'pay');
  const recordedAt = git('rev-parse', 'HEAD');
  await write('src/refund.ts', 'export const refund = 1;\n');
  await write('src/void.ts', 'export const nothing = 1;\n');
  await write('src/refund.test.ts', "import { refund } from './refund';\nexport const refunded = refund;\n");
  await write('src/refund-new.test.ts', "import { refund } from './refund';\nexport const again = refund;\n");
  await write('src/credit.ts', 'export const credit = 1;\n');
  await write('src/credit.test.ts', "import { credit } from './credit';\nexport const credited = credit;\n");
  git('add', '.');
  git('commit', '--quiet', '-m', 'refund');

  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  await updateSourceIndex(at);

  const file = testCoverageFile(at, { suite: 'unit' });
  await mkdir(dirname(file), { recursive: true });
  // Both recorded test files ran whole, and `pay.ts` is the one source file the record holds a row of.
  const observed = (test: string) => ({ file: test, complete: true, preconditions: [] });
  const pay = {
    file: 'src/pay.ts',
    sourceDigest: digestString('export const pay = 1;\n'),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module' as const, digest: digestString('module src/pay.ts'), name: 'src/pay.ts', path: 'module',
      startLine: 1, endLine: 1, source: true, testFiles: ['src/pay.test.ts'],
    }],
  };
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: recordedAt,
    tests: [observed('src/pay.test.ts'), observed('src/refund.test.ts')],
    modules: [pay],
  }, {
    index: encodeExecutionIndex(INDEX as Parameters<typeof encodeExecutionIndex>[0]),
  });
  return { at, recordedAt };
}

async function gapOf(root: string, file: string): Promise<{ readonly text: string; readonly gap: unknown }> {
  const run = async (format: string[]) => {
    let out = '';
    let err = '';
    await main(['covering', '--file', file, '--root', root, ...format], { out: (text) => (out += text), err: (text) => (err += text) });
    return { out, err };
  };
  const json = await run(['--format', 'json']);
  // A root that declares suites is read suite by suite, and refused whole only when none of them ran.
  const said = JSON.parse(json.out) as { gap?: unknown; suites?: readonly { gap?: unknown }[] };
  const text = await run([]);
  return { text: text.out + text.err, gap: said.gap ?? said.suites?.[0]?.gap };
}

describe('a file added after the commit its suite recorded at', () => {
  it('runs the recorded test files selection reaches from it, and counts the cases the record holds of them', async () => {
    const { at, recordedAt } = await checkout();
    const { text, gap } = await gapOf(at, 'src/refund.ts');
    const since = `variance reach --since ${recordedAt.slice(0, 12)}`;

    expect(gap).toEqual({
      question: 'which tests run it',
      scope: 'src/refund.ts',
      known: 'the record predates the file; selection runs 1 recorded test file for it',
      reason: 'stale',
      remedy: 'record',
      run: { suite: 'unit', files: ['src/refund.test.ts'] },
      next: [since],
      cost: { files: 1, tests: 2 },
    });
    expect(text).toContain(
      'Next, Record, 2 tests in 1 test file:\n' +
        '    Run with the runner of `unit`: src/refund.test.ts\n' +
        `    ${since}\n`,
    );
  });

  it('names no run for a file only unrecorded tests import, and leaves them to reach', async () => {
    const { at, recordedAt } = await checkout();
    const { gap } = await gapOf(at, 'src/credit.ts');

    expect(gap).toMatchObject({
      known: 'the record predates the file, and selection runs no recorded test file for it',
      next: [`variance reach --since ${recordedAt.slice(0, 12)}`],
    });
    expect(gap).not.toHaveProperty('run');
    expect(gap).not.toHaveProperty('cost');
  });

  it('names no run for a file nothing imports, and keeps the reach over the diff', async () => {
    const { at, recordedAt } = await checkout();
    const { gap } = await gapOf(at, 'src/void.ts');

    expect(gap).toEqual({
      question: 'which tests run it',
      scope: 'src/void.ts',
      known: 'the record predates the file, and selection runs no recorded test file for it',
      reason: 'stale',
      remedy: 'record',
      next: [`variance reach --since ${recordedAt.slice(0, 12)}`],
    });
  });

  it('asks selection for a suite given to the share too, since the mainline\'s record predates a new file as well', async () => {
    const { at } = await checkout('share');
    const { gap } = await gapOf(at, 'src/refund.ts');

    expect(gap).toMatchObject({ run: { suite: 'unit', files: ['src/refund.test.ts'] } });
    expect((gap as { next: readonly string[] }).next.some((command) => command.startsWith('variance share'))).toBe(false);
  });
});

describe('a suite given to the share with no recording', () => {
  it('fetches the mainline\'s record rather than sending the reader to record one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-older-gap-unrecorded-'));
    made.push(root);
    execFileSync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } } }));

    const { text, gap } = await gapOf(root, 'src/pay.ts');

    expect(gap).toEqual({
      question: 'which tests ran it',
      scope: 'src/pay.ts',
      known: 'no run is recorded',
      reason: 'absent',
      remedy: 'record',
      next: ['variance share --suite unit'],
    });
    expect(text).toContain('Next, Record:\n  variance share --suite unit\n');
  });
});
