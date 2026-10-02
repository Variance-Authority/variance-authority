/**
 * What a driver's Eyes journals become in the record: each attempt beside the
 * case the index names, joined however many workers or hand-overs it took.
 */

import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeStage, foldStage, openStage, recordExecution, stageExecution } from './journal.js';
import { decodeExecutionIndex } from './execution-format.js';
import { caseIndexOf, recordedEyesAt } from './case-record.js';
import { forgetThePage, inRoot, twoCases } from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

describe('a driver whose cases kept Eyes journals', () => {
  const journal = (phase: string) => ({ complete: true, attention: [{ kind: 'eyes-phase', phase, sequence: 0 }] });

  it('lays each attempt of a case retried in another worker beside the case, joined by the id the index gives it', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      const directory = resolve(root, '.stage');
      openStage(directory);

      // Attempt 1 failed in one worker and attempt 2 passed in another; a
      // second case shares the first one's name, so the index numbers it.
      await stageExecution(directory, {
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium, complete: false }],
        cases: [{ file: 'e2e/price.spec.ts', name: 'case', id: 'a', stopped: true, journal: run.premium, eyes: [{ attempt: 1, journal: journal('act') }] }],
      });
      await stageExecution(directory, {
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.plain, complete: true }],
        cases: [
          { file: 'e2e/price.spec.ts', name: 'case', id: 'a', stopped: false, journal: run.premium, eyes: [{ attempt: 2, journal: journal('assert') }] },
          { file: 'e2e/price.spec.ts', name: 'case', id: 'b', journal: run.plain, eyes: [{ attempt: 1, journal: journal('arrange') }] },
        ],
      });
      const staged = await foldStage(directory);
      await recordExecution({ root, cacheRoot: resolve(root, 'cache'), coverageFile, subjects: staged.subjects, cases: staged.cases! });

      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(index.tests.map((test) => test.id)).toEqual(['e2e/price.spec.ts > case', 'e2e/price.spec.ts > case#1']);
      expect(recordedEyesAt(coverageFile)).toEqual({
        watched: ['e2e/price.spec.ts > case', 'e2e/price.spec.ts > case#1'],
        journals: [
          { case: 'e2e/price.spec.ts > case', attempt: 1, journal: journal('act') },
          { case: 'e2e/price.spec.ts > case', attempt: 2, journal: journal('assert') },
          { case: 'e2e/price.spec.ts > case#1', attempt: 1, journal: journal('arrange') },
        ],
      });
      await closeStage(directory);
    });
  });

  it('joins the journals of a case a driver handed over twice to the one case the index holds', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      // One case, drained twice: once for each page it drove.
      await recordExecution({
        root,
        cacheRoot: resolve(root, 'cache'),
        coverageFile,
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }],
        cases: [
          { file: 'e2e/price.spec.ts', name: 'case', id: 'a', journal: run.premium, eyes: [{ attempt: 1, journal: journal('act') }] },
          { file: 'e2e/price.spec.ts', name: 'case', id: 'a', journal: run.plain, eyes: [{ attempt: 2, journal: journal('assert') }] },
        ],
      });

      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(index.tests.map((test) => test.id)).toEqual(['e2e/price.spec.ts > case']);
      expect(recordedEyesAt(coverageFile)).toEqual({
        watched: ['e2e/price.spec.ts > case'],
        journals: [
          { case: 'e2e/price.spec.ts > case', attempt: 1, journal: journal('act') },
          { case: 'e2e/price.spec.ts > case', attempt: 2, journal: journal('assert') },
        ],
      });
    });
  });

  it('keeps no Eyes section for a run whose cases kept none', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      await recordExecution({
        root,
        cacheRoot: resolve(root, 'cache'),
        coverageFile,
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }],
        cases: [{ file: 'e2e/price.spec.ts', name: 'case', id: 'a', journal: run.premium }],
      });

      expect(recordedEyesAt(coverageFile)).toBeUndefined();
    });
  });

  it('keeps a section naming the case for a run that opened a journal and handed none over', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      await recordExecution({
        root,
        cacheRoot: resolve(root, 'cache'),
        coverageFile,
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }],
        cases: [{ file: 'e2e/price.spec.ts', name: 'case', id: 'a', journal: run.premium, eyes: [] }],
      });

      expect(recordedEyesAt(coverageFile)).toEqual({ watched: ['e2e/price.spec.ts > case'], journals: [] });
    });
  });
});
