import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutcomeComparison } from '@variance-authority/sense/story';
import { encodeAsSetExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { formatOutcomes, recordedOutcomes } from './story-outcomes.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A checkout whose one record keeps, of the case `clicks` in each of `files`, a reading for each outcome in `stopped`. */
async function checkout(files: readonly string[], stopped: readonly boolean[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-authority-outcomes-'));
  roots.push(root);
  const tests = files.map((file) => ({ id: `${file} > clicks`, file, name: 'clicks', stopped: stopped[0]! }));
  const readings = Object.fromEntries(tests.map(({ id }) => [id, stopped.map((one) => ({ count: 1, stopped: one, regions: [] }))]));
  await writeTestCoverage(testCoverageFile(root), { version: 3, instrumentation: 'fixture', tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex({ tests, modules: [] }),
    readings: Buffer.from(JSON.stringify({ cases: readings })),
  });
  return root;
}

describe('recordedOutcomes', () => {
  it('refuses a name that is a case in two files, naming both', async () => {
    const root = await checkout(['a.test.ts', 'b.test.ts'], [false, true]);

    expect(() => recordedOutcomes(root, [], 'clicks', undefined)).toThrow('--name clicks is a case in a.test.ts and b.test.ts; name the file with --file');
    expect(recordedOutcomes(root, [], 'clicks', 'a.test.ts')?.outcomes).toMatchObject({ passed: 1, threw: 1 });
  });

  it('says a case the record kept under one outcome only has nothing to compare', async () => {
    const root = await checkout(['a.test.ts'], [false, false]);

    expect(() => recordedOutcomes(root, [], 'clicks', undefined)).toThrow('every one of the 2 runs the record keeps of a.test.ts > clicks passed');
  });

  it('leaves a case a story is taped of to the story', async () => {
    const root = await checkout(['a.test.ts'], [false, true]);

    expect(recordedOutcomes(root, [{ path: 'a.story', file: 'a.test.ts', name: 'clicks', visits: 1 }], 'clicks', undefined)).toBeUndefined();
  });
});

describe('outcomes of one case compared from the record', () => {
  const page = { file: 'src/page.ts', startLine: 3, endLine: 5 };
  const OUTCOMES: OutcomeComparison = {
    file: 'test/page.test.ts',
    name: 'clicks',
    passed: 2,
    threw: 2,
    onlyPassed: [{ ...page, name: 'wire', path: 'entry' }],
    onlyThrew: [],
    moved: [{ region: { ...page, name: 'wire', path: 'entry' }, passed: { line: 4 }, threw: { line: 6 } }],
    unsteady: 3,
    single: false,
  };

  it('prints each region by how its charge moved with the outcome, and counts what moves within one', () => {
    expect(formatOutcomes(OUTCOMES, 'text')).toBe(`${[
      'compare  test/page.test.ts > clicks, from the readings the record keeps',
      '  passed (2 runs) against threw (2 runs)',
      '',
      '  charged to a later line when it threw, on every run:',
      '    wire  src/page.ts:3-5  line 4 when it passed, line 6 when it threw',
      '',
      '  reached only when it passed, on every run:',
      '    wire  src/page.ts:3-5',
      '',
      '  left out, because they differ between runs of one outcome as well: 3 regions',
    ].join('\n')}\n`);
  });

  it('says nothing separates the outcomes, and warns of a side read once', () => {
    const text = formatOutcomes({ ...OUTCOMES, threw: 1, onlyPassed: [], moved: [], unsteady: 0, single: true }, 'text');

    expect(text).toContain('one run on a side');
    expect(text).toContain('nothing separates the outcomes');
  });
});
