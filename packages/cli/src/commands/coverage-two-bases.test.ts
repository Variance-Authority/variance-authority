import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { publishLine } from '@variance-authority/core/share';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import type { Config } from '../config.js';
import { frame, suiteEntry } from '../share-entries.js';
import { lineCellOf } from '../share-lines.js';
import type { Coverage } from './coverage.js';
import { BEFORE, DISCOUNTS, cloneOf, git } from './mainline-fixture.js';

/**
 * Two suites given to one share, whose mainline published each at a commit of
 * its own. The change since edits prose no suite loads; the one sentence that
 * says so names one commit it was diffed from, and two bases name two.
 */

let home: string;
let clone: string;
let first: string;
let second: string;
const cwd = process.cwd();

const CASES: ExecutionIndex = {
  tests: [DISCOUNTS],
  modules: [{
    file: 'src/total.ts',
    blocks: [{ kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] }],
  }],
};

const share = () => ({ kind: 'directory', root: join(home, 'share'), mainlines: ['main'] }) as const;

/** The record a run of `suite` makes in `dir`, at `commit` when it names one. */
async function recorded(dir: string, suite: string, commit?: string): Promise<string> {
  const record = testCoverageFile(dir, { suite });
  await mkdir(dirname(record), { recursive: true });
  await writeTestCoverage(record, {
    version: 3,
    instrumentation: 'fixture',
    ...(commit === undefined ? {} : { commit }),
    tests: [{ file: DISCOUNTS.file, complete: true, preconditions: [] }],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: digestString(BEFORE),
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'function', digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount',
        startLine: 1, endLine: 3, source: true, testFiles: [DISCOUNTS.file],
      }],
    }],
  }, {
    index: encodeExecutionIndex(CASES),
    ...(commit === undefined ? {} : { last: Buffer.from(JSON.stringify({ commit, at: '2026-09-26T00:00:00.000Z', files: [DISCOUNTS.file], cases: [DISCOUNTS.id] })) }),
  });
  return record;
}

/** `suite`'s record in `dir`, published to the mainline at `commit`. */
async function published(dir: string, suite: string, commit: string): Promise<void> {
  const cell = await lineCellOf({ share: share() } as unknown as Config);
  if (cell === undefined || !('load' in cell)) throw new Error(`the share in ${home} is not a line cell: ${JSON.stringify(cell)}`);
  const bytes = frame([['coverage.bin', await readFile(await recorded(dir, suite, commit))]]);
  const done = await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name: suiteEntry(suite), commit, bytes }], {
    descends: async () => undefined,
    image: async (digest) => { throw new Error(`no image ${digest}`); },
  });
  if (!('written' in done) || !done.written.includes(suiteEntry(suite))) {
    throw new Error(`${suite} was to reach mainline main, and the share answered ${JSON.stringify(done)}`);
  }
}

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-coverage-two-bases-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
  const origin = join(home, 'origin.git');
  const ci = join(home, 'ci');
  await git(home, 'init', '--quiet', '--bare', '--initial-branch', 'main', origin);
  await git(home, 'init', '--quiet', '--initial-branch', 'main', ci);
  await git(ci, 'config', 'user.email', 'fixture@example.test');
  await git(ci, 'config', 'user.name', 'Fixture');
  await mkdir(join(ci, 'src'));
  await mkdir(join(ci, 'test'));
  await writeFile(join(ci, 'src/total.ts'), BEFORE);
  await writeFile(join(ci, DISCOUNTS.file), "it('discounts', () => {});\n");
  await writeFile(join(ci, 'README.md'), '# total\n');
  await writeFile(join(ci, 'variance.config.json'), JSON.stringify({
    suites: { unit: { kind: 'unit', carry: 'share' }, e2e: { kind: 'e2e', carry: 'share' } },
    share: share(),
  }));
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'first');
  first = await git(ci, 'rev-parse', 'HEAD');
  await published(ci, 'unit', first);
  await writeFile(join(ci, 'README.md'), '# total\n\nDiscounts.\n');
  await git(ci, 'commit', '--quiet', '-am', 'second');
  second = await git(ci, 'rev-parse', 'HEAD');
  await published(ci, 'e2e', second);
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');

  clone = await cloneOf(home, origin);
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
  await recorded(clone, 'unit');
  await recorded(clone, 'e2e');
  await writeFile(join(clone, 'README.md'), '# total\n\nDiscounts, once.\n');
  // The pipeline step that publishes the source index before `coverage`, which under CI never builds one.
  process.chdir(clone);
  const indexed = await ask(['index']);
  if (indexed.code !== 0) throw new Error(`variance index failed in ${clone}: ${indexed.err}`);
});

afterAll(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

describe('coverage of a change no suite loads, against bases published at two commits', () => {
  it('prints the whole count, since no one commit says what changed since every base', async () => {
    const answer = await ask(['coverage', '--root', clone, '--format', 'json']);

    expect(answer.code).toBe(0);
    const said = JSON.parse(answer.out) as Coverage;
    expect(Object.fromEntries(said.suites.map((suite) => [suite.suite, suite.base?.commit]))).toEqual({ unit: first, e2e: second });
    expect(said.suites.map((suite) => suite.base?.change.lost)).toEqual([0, 0]);
    expect(said.unloadedChange).toBeUndefined();
  });
});
