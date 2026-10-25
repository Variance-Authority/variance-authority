import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { main } from '../bin.js';

/**
 * The gap a record older than the asked file leaves: the test files of that
 * suite that reach the file by import, never the suite, or the mainline's
 * record when the suite is given to the share and the mainline holds the file.
 * A suite with no record is sent to the share the same way.
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

/** Two recorded test files, of which only `refund.test.ts` imports the file added since. */
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
 * A checkout whose `unit` record was made before `src/refund.ts` existed;
 * `src/void.ts`, added with it, no test imports. `mainline` is the commit the
 * remote's default branch points at: `before` the file, or `after` it.
 */
async function checkout(carry: 'share' | undefined, mainline: 'before' | 'after'): Promise<string> {
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
  const then = git('rev-parse', 'HEAD');
  await write('src/refund.ts', 'export const refund = 1;\n');
  await write('src/void.ts', 'export const nothing = 1;\n');
  await write('src/refund.test.ts', "import { refund } from './refund';\nexport const refunded = refund;\n");
  git('add', '.');
  git('commit', '--quiet', '-m', 'refund');
  git('update-ref', 'refs/remotes/origin/main', mainline === 'after' ? git('rev-parse', 'HEAD') : then);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

  const file = testCoverageFile(at, { suite: 'unit' });
  await mkdir(dirname(file), { recursive: true });
  await writeTestCoverage(file, { version: 3, instrumentation: INSTRUMENTATION_ID, commit: then, tests: [], modules: [] }, {
    index: encodeExecutionIndex(INDEX as Parameters<typeof encodeExecutionIndex>[0]),
  });
  return at;
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
  it('names the test files the record ran that reach the file by import, and costs those, never the suite', async () => {
    const { text, gap } = await gapOf(await checkout(undefined, 'after'), 'src/refund.ts');

    expect(gap).toEqual({
      question: 'which tests run it',
      scope: 'src/refund.ts',
      known: 'the record predates the file; 1 test file it ran reaches the file by import',
      reason: 'stale',
      gear: 'record',
      run: { suite: 'unit', files: ['src/refund.test.ts'] },
      next: [],
      cost: { tests: 2, files: 1 },
    });
    expect(text).toContain('Next, Record, 2 tests in 1 test file:\n    Run with the runner of `unit`: src/refund.test.ts\n');
  });

  it('says no test file it ran reaches a file nothing imports, and widens to nothing', async () => {
    const { gap } = await gapOf(await checkout(undefined, 'after'), 'src/void.ts');

    expect(gap).toEqual({
      question: 'which tests run it',
      scope: 'src/void.ts',
      known: 'the record predates the file, and no test file it ran reaches the file by import',
      reason: 'stale',
      gear: 'record',
      next: ['variance ask discover --to src/void.ts'],
    });
  });

  it('fetches the mainline\'s record in a suite given to the share when the mainline holds the file', async () => {
    const { text, gap } = await gapOf(await checkout('share', 'after'), 'src/refund.ts');

    expect(gap).toMatchObject({
      known: 'the record predates the file, and the mainline holds it, so its record holds the file once the mainline has recorded since',
      gear: 'record',
      next: ['variance share --suite unit'],
    });
    expect(gap).not.toHaveProperty('run');
    expect(text).toContain('Next, Record:\n    variance share --suite unit\n');
  });

  it('runs the test files that reach it in a suite given to the share when the mainline does not hold the file yet', async () => {
    const { gap } = await gapOf(await checkout('share', 'before'), 'src/refund.ts');

    expect(gap).toMatchObject({
      known: 'the record predates the file, which the mainline does not hold yet; 1 test file it ran reaches the file by import',
      run: { suite: 'unit', files: ['src/refund.test.ts'] },
      next: [],
      cost: { tests: 2, files: 1 },
    });
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
      gear: 'record',
      next: ['variance share --suite unit'],
    });
    expect(text).toContain('Next, Record:\n  variance share --suite unit\n');
  });
});
