import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testCoverageFile, encodeExecutionIndex, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask search` about the name a test ran under. The record holds it
 * however the file spelled the block, so the answer is the record's: it lags
 * the checkout, and says when there was no record to read.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-search-cases-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const FILES = {
  'packages/kit/src/route.ts': 'export const route = 1;\n',
  'packages/kit/src/route.test.ts': "import { route } from './route';\nexport const used = route;\n",
  'packages/kit/src/other.test.ts': 'export const other = 1;\n',
};

const ALONE = 'packages/kit/src/route.test.ts';

/** Lay a suite's record of `cases`, each a test file and the name it ran under. */
async function record(cases: readonly (readonly [string, string])[], suite?: string): Promise<void> {
  const at = testCoverageFile(process.cwd(), { suite });
  mkdirSync(dirname(at), { recursive: true });
  const tests = cases.map(([file, name]) => ({ id: `${file} > ${name}`, file, name }));
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [...new Set(cases.map(([file]) => file))].map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [],
  }, { index: encodeExecutionIndex({ tests, modules: [] }) });
}

const searched = async (...argv: readonly string[]): Promise<string> => {
  const { code, out, err } = await run(['ask', 'search', ...argv]);
  expect(err).toBe('');
  expect(code).toBe(EXIT_CLEAN);
  return out;
};

describe('variance ask search about the name a test ran under', () => {
  beforeEach(async () => {
    checkout(FILES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('lists the case by the name the record holds, and its test file', async () => {
    await record([[ALONE, 'alone > a subject nothing else touched']]);

    const answer = await searched('--query', 'a subject nothing else touched');

    expect(answer).toContain(`alone > a subject nothing else touched [test] — ${ALONE}`);
    expect(answer).toContain('1 recorded test case holds every word, as the last run wrote it:');
  });

  it('holds every word in any order, and no case that lacks one', async () => {
    await record([[ALONE, 'alone > a subject nothing else touched'], [ALONE, 'alone > a subject']]);

    const answer = await searched('--query', 'touched SUBJECT');

    expect(answer).toContain('alone > a subject nothing else touched [test]');
    expect(answer).not.toContain('alone > a subject [test]');
  });

  it('puts a case that writes the phrase first, then by file and name', async () => {
    await record([[ALONE, 'zig before zag'], ['packages/kit/src/other.test.ts', 'zag before zig'], [ALONE, 'zag then zig'], [ALONE, 'a zig zag']]);

    const rows = (await searched('--query', 'zig zag')).split('\n').filter((line) => line.includes('[test]'));

    expect(rows.map((row) => row.split(' [test]')[0])).toEqual(['a zig zag', 'zag before zig', 'zag then zig', 'zig before zag']);
  });

  it('shows the first few and counts the rest', async () => {
    await record(Array.from({ length: 30 }, (_, at) => [ALONE, `numbered case ${String(at).padStart(2, '0')}`] as const));

    const answer = await searched('--query', 'numbered case');

    expect(answer.split('\n').filter((line) => line.includes('[test]'))).toHaveLength(25);
    expect(answer).toContain('30 recorded test cases hold every word');
    expect(answer).toContain('5 more not shown.');
  });

  it('keeps to the area a start point names', async () => {
    await record([[ALONE, 'inside the area'], ['packages/kit/src/other.test.ts', 'outside the area']]);

    const answer = await searched('--query', 'the area', '--to', 'packages/kit/src/route.ts');

    expect(answer).toContain('inside the area [test]');
    expect(answer).not.toContain('outside the area [test]');
  });

  it('leaves the names that answer beside the cases', async () => {
    await record([[ALONE, 'route reads']]);

    const answer = await searched('--query', 'route');

    expect(answer).toContain('route reads [test]');
    expect(answer).toContain('packages/kit/src/route.ts');
  });

  it('answers in json what the text answers', async () => {
    await record([[ALONE, 'alone > twice over']]);

    const { out } = await run(['ask', 'search', '--query', 'twice over', '--format', 'json']);

    expect(JSON.parse(out).tests).toEqual({
      total: 1,
      shown: [{ source: 'test', name: 'alone > twice over', at: ALONE }],
      read: 1,
      unread: [],
    });
  });
});

describe('an empty answer about a recorded case', () => {
  beforeEach(async () => {
    checkout(FILES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('counts the recorded cases among what was read', async () => {
    await record([[ALONE, 'reads']]);

    expect(await searched('--query', 'qzxvk')).toContain('nor a recorded test case, writes `qzxvk`');
  });

  it('says no recorded case was read when no run kept one', async () => {
    const answer = await searched('--query', 'qzxvk');

    expect(answer).toContain('no recorded case was read');
    expect(answer).not.toContain('nor a recorded test case');
  });

});

describe('a search where the root config declares suites', () => {
  beforeEach(async () => {
    checkout({ ...FILES, 'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' }, chromium: { kind: 'e2e' } } }) });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('lists a case two suites ran as one row', async () => {
    await record([[ALONE, 'twice over']], 'unit');
    await record([[ALONE, 'twice over']], 'chromium');

    const answer = await searched('--query', 'twice over');

    expect(answer.split('\n').filter((line) => line.includes('[test]'))).toHaveLength(1);
    expect(answer).toContain('1 recorded test case holds');
  });

  it('names the suite whose cases were not read', async () => {
    await record([[ALONE, 'reads']], 'unit');

    expect(await searched('--query', 'qzxvk')).toContain('no recorded case of `chromium` was read');
  });
});
