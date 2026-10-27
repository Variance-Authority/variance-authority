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
 * `covering` paints a record made at one commit onto the checkout at another,
 * so every answer read from a record says how far that record is behind
 * `HEAD`, as `review` says it of the mainline's.
 */

let cache: string;
let previous: string | undefined;
const made: string[] = [];

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-covering-behind-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await Promise.all([cache, ...made].map((dir) => rm(dir, { recursive: true, force: true })));
});

const INDEX = {
  tests: [{ id: 'p', file: 'src/pay.test.ts', name: 'charges once' }],
  modules: [{
    file: 'src/pay.ts',
    blocks: [{ kind: 'function', name: 'pay', path: 'entry', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0 }] }],
  }],
};

/**
 * A checkout whose `unit` record was made at its first commit, `behind`
 * commits before `HEAD`; on a side branch `aside` commits past that first
 * commit, when given, so the record and `HEAD` have diverged; or at
 * `recordedAt`, a commit this clone may not hold.
 */
async function checkout(behind: number, options: { readonly aside?: number; readonly recordedAt?: string } = {}): Promise<{ readonly at: string; readonly commit: string }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-covering-behind-'));
  made.push(at);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: at, encoding: 'utf8' }).trim();
  const write = async (file: string, text: string) => {
    await mkdir(dirname(join(at, file)), { recursive: true });
    await writeFile(join(at, file), text);
  };
  const commits = async (count: number, folder: string) => {
    for (let one = 0; one < count; one += 1) {
      await write(`${folder}/${String(one)}.md`, `${String(one)}\n`);
      git('add', '.');
      git('commit', '--quiet', '-m', `${folder} ${String(one)}`);
    }
  };
  git('init', '--quiet', '--initial-branch', 'main');
  await write('package.json', '{"name":"covering-behind-fixture","private":true}\n');
  await write('variance.config.json', JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
  await write('src/pay.ts', 'export const pay = 1;\n');
  await write('src/pay.test.ts', "import { pay } from './pay';\nexport const paid = pay;\n");
  git('add', '.');
  git('commit', '--quiet', '-m', 'pay');
  let commit = options.recordedAt ?? git('rev-parse', 'HEAD');
  if (options.aside !== undefined) {
    git('checkout', '--quiet', '-b', 'side');
    await commits(options.aside, 'side');
    commit = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', 'main');
  }
  await commits(behind, 'notes');

  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  await updateSourceIndex(at);

  const file = testCoverageFile(at, { suite: 'unit' });
  await mkdir(dirname(file), { recursive: true });
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
    commit,
    tests: [{ file: 'src/pay.test.ts', complete: true, preconditions: [] }],
    modules: [pay],
  }, {
    index: encodeExecutionIndex(INDEX as Parameters<typeof encodeExecutionIndex>[0]),
  });
  return { at, commit };
}

async function ask(root: string, ...argv: string[]): Promise<{ readonly text: string; readonly json: Record<string, unknown> }> {
  const run = async (format: string[]) => {
    let out = '';
    let err = '';
    await main(['covering', '--root', root, ...argv, ...format], { out: (text) => (out += text), err: (text) => (err += text) });
    return out + err;
  };
  const said = JSON.parse(await run(['--format', 'json'])) as { suites: readonly Record<string, unknown>[] };
  return { text: await run([]), json: said.suites[0]! };
}

describe('a record behind the checkout', () => {
  it('names the record\'s commit and how many commits HEAD is past it, for a file and for a line', async () => {
    const { at, commit } = await checkout(3);

    const file = await ask(at, '--file', 'src/pay.ts');
    expect(file.json).toMatchObject({ at: commit, behind: 3, ahead: 0 });
    expect(file.text).toContain(`The record was made at ${commit.slice(0, 12)}, 3 commit(s) before HEAD.\n`);

    const line = await ask(at, '--file', 'src/pay.ts', '--line', '1');
    expect(line.json).toMatchObject({ at: commit, behind: 3, ahead: 0 });
    expect(line.text).toContain(`The record was made at ${commit.slice(0, 12)}, 3 commit(s) before HEAD.\n`);
  });

  it('says a record made at HEAD is HEAD', async () => {
    const { at, commit } = await checkout(0);
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, behind: 0, ahead: 0 });
    expect(text).toContain(`The record was made at ${commit.slice(0, 12)}, which is HEAD.\n`);
  });

  it('counts both sides of a record made on another branch, which the clone holds', async () => {
    const { at, commit } = await checkout(3, { aside: 2 });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, behind: 3, ahead: 2 });
    expect(text).toContain(`The record was made at ${commit.slice(0, 12)}, which this checkout does not contain: HEAD holds 3 commit(s) the record does not, and the record 2 that HEAD does not.\n`);
  });

  it('says how far past HEAD a record made after it is', async () => {
    const { at, commit } = await checkout(0, { aside: 2 });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, behind: 0, ahead: 2 });
    expect(text).toContain(`The record was made at ${commit.slice(0, 12)}, 2 commit(s) past HEAD, which this checkout does not contain.\n`);
  });

  it('names the commit and says the clone cannot count when it does not hold it', async () => {
    const foreign = 'f'.repeat(40);
    const { at } = await checkout(1, { recordedAt: foreign });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: foreign });
    expect(json).not.toHaveProperty('behind');
    expect(json).not.toHaveProperty('ahead');
    expect(text).toContain(`The record was made at ${foreign.slice(0, 12)}, which this clone cannot count to HEAD: it does not hold the commit, or its history is too shallow to walk.\n`);
  });
});
