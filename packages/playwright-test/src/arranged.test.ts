import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { testSelectionProbes, type PreconditionStanding } from '@variance-authority/sense/journal';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { decodeExecutionIndex, repositoryRoot } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { arrangedText, snapshotCaseOf, type SnapshotCase } from './arranged.js';
import { createExecutionRecorder } from './execution.js';
import { caseKey } from './test-coordinate.js';

/**
 * What a snapshot taken inside a case says about the case.
 *
 * Read through the text because the text is what a reader is handed: the
 * failing assertion's message and the annotation Playwright's report shows
 * under the test, passing or not.
 */

const CASE = { file: 'tests/checkout.spec.ts', name: 'mocked > pays', id: 'abc-123' };

describe('arrangedText', () => {
  it('names the case the snapshot was taken in, and each precondition with the call that said it', () => {
    const taken: SnapshotCase = {
      ...CASE,
      preconditions: [
        { name: 'network', value: 'mocked', site: 'tests/checkout.spec.ts:12', level: 0xffff },
        { name: 'seeded', value: true, site: 'tests/checkout.spec.ts:8', level: 0 },
      ],
    };

    expect(arrangedText(taken)).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, ran under network=mocked (tests/checkout.spec.ts:12), ' +
        'seeded (tests/checkout.spec.ts:8)',
    );
  });

  it('keeps both values of a contradiction, as `variance covering` prints it', () => {
    const taken: SnapshotCase = {
      ...CASE,
      preconditions: [
        { name: 'network', value: 'live', site: 'tests/checkout.spec.ts:20', level: 0xffff },
        { name: 'network', value: 'mocked', site: 'tests/checkout.spec.ts:21', level: 0xffff },
      ],
    };

    expect(arrangedText(taken)).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, ran under network contradicted: ' +
        'live (tests/checkout.spec.ts:20), mocked (tests/checkout.spec.ts:21)',
    );
  });

  it('prints a case recorded with no preconditions as recording none', () => {
    expect(arrangedText({ ...CASE, preconditions: [] })).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, no preconditions recorded',
    );
  });

  it('prints a run that did not record preconditions as unmeasured, not empty', () => {
    expect(arrangedText(CASE)).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, preconditions unmeasured: varianceExecution is off, ' +
        'so no variancePrecondition call was recorded',
    );
  });

});

/** The runner's view of one test declared in `tests/checkout.spec.ts` under `root`. */
function testInfoIn(root: string, testId: string, title: string): TestInfo {
  return {
    project: { name: 'chromium' },
    file: resolve(root, 'tests/checkout.spec.ts'),
    titlePath: ['chromium', 'tests/checkout.spec.ts', 'mocked', title],
    testId,
  } as unknown as TestInfo;
}

const lines = (taken: SnapshotCase) => taken.preconditions?.map(({ name, value, level }) => [name, value, level]);

describe('snapshotCaseOf', () => {
  it('names the running case by the row\'s key, with what it has said so far and only that', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-arranged-'));
    try {
      const coverageFile = resolve(root, 'coverage.bin');
      const cacheRoot = resolve(root, 'cache');
      const source = 'export const price = (amount) => amount * 2;\n';
      await writeFile(resolve(root, 'price.js'), source, 'utf8');
      testSelectionProbes({ root, cacheRoot }).transform(source, resolve(root, 'price.js'));
      const pays = testInfoIn(root, 'one', 'pays');
      const refunds = testInfoIn(root, 'two', 'refunds');
      const owner = 'tests/checkout.spec.ts';
      let standing: PreconditionStanding = { at: 'beforeEach', key: caseKey(owner, 'one'), depth: 1 };
      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile }, undefined, () => standing);

      variancePrecondition({ network: 'live' });
      standing = { at: 'case', key: caseKey(owner, 'one') };
      variancePrecondition({ network: 'mocked' });

      const taken = snapshotCaseOf(pays, recorder);
      expect({ ...taken, preconditions: lines(taken) }).toEqual({
        file: owner,
        name: 'mocked > pays',
        id: 'one',
        // The body's call overrides the beforeEach's, as it does on the row.
        preconditions: [['network', 'mocked', 0xffff]],
      });
      expect(taken.preconditions![0]!.site).toMatch(/arranged\.test\.ts:\d+$/);
      // Another case of the same file has said nothing.
      expect(snapshotCaseOf(refunds, recorder).preconditions).toEqual([]);

      // Said after the snapshot: on the next view and on the row, not on the one taken.
      variancePrecondition({ seeded: true });
      expect(lines(taken)).toHaveLength(1);
      expect(lines(snapshotCaseOf(pays, recorder))).toEqual([['network', 'mocked', 0xffff], ['seeded', true, 0xffff]]);

      // Reading what a case holds leaves it in place for the row.
      const drained = {
        evaluate: async () => ({ instrumentation: 'sense:instrument/presence-v5', modules: [{ id: 'price.js', hits: [0], shared: [] }] }),
      } as unknown as Page;
      await recorder.note(drained, owner, { name: 'mocked > pays', id: 'one' });
      recorder.mark(owner, true, { name: 'mocked > pays', id: 'one' });
      await recorder.close();
      const index = decodeExecutionIndex(await readFile(coverageFile));
      expect(index.tests.map((one) => [one.name, one.preconditions?.map(({ name, value }) => [name, value])]))
        .toEqual([['mocked > pays', [['network', 'mocked'], ['seeded', true]]]]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves the preconditions of a case nothing listened to absent, not empty', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-arranged-'));
    try {
      const recorder = createExecutionRecorder({ root, coverageFile: resolve(root, 'coverage.bin') });
      const taken = snapshotCaseOf(testInfoIn(root, 'one', 'pays'), recorder);
      await recorder.close();
      expect(taken).toEqual({ file: 'tests/checkout.spec.ts', name: 'mocked > pays', id: 'one' });
      expect('preconditions' in taken).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('names the file from the checkout the process runs in when there is no recorder', () => {
    const here = repositoryRoot(process.cwd());
    const taken = snapshotCaseOf(testInfoIn(here, 'one', 'pays'), undefined);
    expect(taken).toEqual({ file: relative(here, resolve(here, 'tests/checkout.spec.ts')), name: 'mocked > pays', id: 'one' });
  });
});

describe('what a snapshot cannot say yet', () => {
  // FIXME: the case's row and the run's one record (spec 0094) do not name
  // the snapshots taken in the case, so a reviewer reaches the case from the
  // snapshot and not back.
  it.todo('names each snapshot on the row of the case it was taken in — needs an observation section on the case rows of the one record');

  // FIXME: `names.axes` is parsed and read only in `packages/cli`, so a worker
  // cannot read the grammar until it moves to `@variance-authority/sense`, as
  // `parseSuites` did. See spec 0093, "A snapshot taken inside a case".
  it.todo('reports by name an axis whose subject coordinate disagrees with the value the case said — needs the names grammar readable from a worker');
});
