/**
 * What a recorded run leaves beside the record: one summary row, so two runs
 * leave two (`run-rows.ts`).
 */

import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordExecution } from './journal.js';
import { readRunRows } from './run-rows.js';
import { forgetThePage, inRoot, twoCases } from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

describe('a recorded run leaves one summary row', () => {
  it('leaves two rows for two runs, each with the time the files cost and the cases it laid', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      const options = { root, cacheRoot: resolve(root, 'cache'), coverageFile };
      const cases = [{ file: 'e2e/price.spec.ts', name: 'case', id: 'a', journal: run.premium }];

      await recordExecution({ ...options, subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium, duration: 300 }, { owner: 'e2e/other.spec.ts', journal: run.plain, duration: 200 }], cases });
      await recordExecution({ ...options, subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }] });

      const rows = readRunRows(coverageFile);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ duration: 500, cases: 1 });
      expect(rows[0]!.at).toMatch(/^\d{4}-\d\d-\d\dT/);
      // The second run timed nothing and kept no case: both are absent, not zero.
      expect(rows[1]).not.toHaveProperty('duration');
      expect(rows[1]).not.toHaveProperty('cases');
    });
  });
});
