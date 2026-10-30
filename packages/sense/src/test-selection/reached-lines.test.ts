/**
 * The lines a driver hands over with each case, as the case index keeps them:
 * handed straight to the journal, or staged by workers and folded first.
 */

import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { foldStage, recordExecution, stageExecution, type ObservedCase } from './journal.js';
import { decodeExecutionIndex } from './execution-format.js';
import { openSetColumns } from './execution-set-format.js';
import { lineAt, linesOf } from './case-lines.js';
import { caseIndexOf } from './case-record.js';
import { PREMIUM_LINE, forgetThePage, inRoot, twoCases } from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

describe('a driver that cut its test file', () => {
  it('keeps the test line that first reached each region of a case that says, handed over or staged', async () => {
    for (const staged of [false, true]) {
      await inRoot(async (root) => {
        const cacheRoot = resolve(root, 'cache');
        const coverageFile = resolve(root, 'coverage.bin');
        const run = twoCases(root);
        await run.write();
        // The premium case's statement at line 7 reached everything it
        // entered but one region, which its teardown drained with no statement.
        const [entered] = run.premium.modules;
        const lines = [{ id: entered!.id, hits: entered!.hits.slice(1), lines: entered!.hits.slice(1).map(() => 7) }];
        const handed: ObservedCase[] = [
          { file: 'e2e/price.spec.ts', name: 'charges twice above ten', id: 'a', journal: run.premium, lines },
          { file: 'e2e/price.spec.ts', name: 'charges the amount below it', id: 'b', journal: run.plain },
        ];
        let cases: readonly ObservedCase[] = handed;
        if (staged) {
          const directory = resolve(root, '.stage');
          for (const observed of handed) await stageExecution(directory, { subjects: [], cases: [observed] });
          cases = (await foldStage(directory)).cases!;
        }
        await recordExecution({ root, cacheRoot, coverageFile, subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }], cases });

        const bytes = (await caseIndexOf(coverageFile))!;
        const index = decodeExecutionIndex(bytes);
        const module = index.modules.findIndex((entry) => entry.file === 'price.js');
        const block = index.modules[module]!.blocks.findLastIndex((entry) => entry.startLine <= PREMIUM_LINE && PREMIUM_LINE <= entry.endLine);
        const of = (name: string) => linesOf(openSetColumns(bytes)!.testLines, index.tests.findIndex((test) => test.name === name));
        const premium = of('charges twice above ten');
        expect(premium, staged ? 'staged' : 'handed over').toBeDefined();
        expect(lineAt(premium!, module, block)).toEqual({ line: 7, ambient: false });
        // The function's own region was the one no statement reached.
        expect(lineAt(premium!, module, 0)).toEqual({ line: 0, ambient: true });
        expect(of('charges the amount below it')).toBeUndefined();
      });
    }
  });

  it("keeps a hook's line as a hook's, handed over or staged", async () => {
    for (const staged of [false, true]) await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      // A beforeEach statement at line 3 reached every region the case entered.
      const [entered] = run.premium.modules;
      const lines = [{ id: entered!.id, hits: entered!.hits, lines: entered!.hits.map(() => 3), ambient: entered!.hits.map(() => true) }];
      let cases: readonly ObservedCase[] = [{ file: 'e2e/price.spec.ts', name: 'charges twice above ten', id: 'a', journal: run.premium, lines }];
      if (staged) {
        const directory = resolve(root, '.stage');
        await stageExecution(directory, { subjects: [], cases });
        cases = (await foldStage(directory)).cases!;
      }
      await recordExecution({ root, cacheRoot, coverageFile, subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }], cases });

      const bytes = (await caseIndexOf(coverageFile))!;
      const index = decodeExecutionIndex(bytes);
      const module = index.modules.findIndex((entry) => entry.file === 'price.js');
      const premium = linesOf(openSetColumns(bytes)!.testLines, index.tests.findIndex((test) => test.name === 'charges twice above ten'));
      expect(lineAt(premium!, module, 0), staged ? 'staged' : 'handed over').toEqual({ line: 3, ambient: true });
    });
  });
});
