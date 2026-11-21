/**
 * Which recordings keep the checks a run's cases declared and entered: one that
 * holds the whole run, and not a process that holds only its share of it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordExecution } from './journal.js';
import { caseIndexOf, recordedChecksAt } from './case-record.js';
import { forgetThePage, inRoot, twoCases } from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

describe('a driver that records the checks of its cases', () => {
  it('keeps no checks from a process that recorded only its own cases', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      await mkdir(resolve(root, 'e2e'), { recursive: true });
      await writeFile(resolve(root, 'e2e/price.spec.ts'), [
        "import { checked } from '@variance-authority/sense/checked';",
        "test('charges twice above ten', async () => {",
        "  await checked('price/doubled', async () => {});",
        '});',
        '',
      ].join('\n'));

      const share = {
        root,
        cacheRoot,
        coverageFile,
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }],
        cases: [{
          file: 'e2e/price.spec.ts', name: 'charges twice above ten', id: 'a', journal: run.premium,
          attempts: [{ attempt: 1, ended: 'passed' as const }], checks: [],
        }],
      };

      await recordExecution(share);
      expect(recordedChecksAt(coverageFile)).toBeDefined();
      // Each Playwright worker without the reporter records alone, so the last
      // to land would replace the checks the others' cases entered.
      await recordExecution({ ...share, partial: true });
      expect(await caseIndexOf(coverageFile)).toBeDefined();
      expect(recordedChecksAt(coverageFile)).toBeUndefined();
    });
  });

  it('loses the checks one share entered when another lands after it whole, which is what `partial` keeps from being read', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      await mkdir(resolve(root, 'e2e'), { recursive: true });
      const spec = (name: string, check: string) => [
        "import { checked } from '@variance-authority/sense/checked';",
        `test('${name}', async () => {`,
        `  await checked('${check}', async () => {});`,
        '});',
        '',
      ].join('\n');
      await writeFile(resolve(root, 'e2e/price.spec.ts'), spec('charges twice above ten', 'price/doubled'));
      await writeFile(resolve(root, 'e2e/stock.spec.ts'), spec('holds the last one', 'stock/held'));
      const share = (file: string, name: string, journal: typeof run.premium) => ({
        root,
        cacheRoot,
        coverageFile,
        subjects: [{ owner: file, journal }],
        cases: [{ file, name, id: file, journal, attempts: [{ attempt: 1, ended: 'passed' as const }], checks: [] }],
      });

      // Two Playwright workers without the reporter, each holding one spec.
      await recordExecution(share('e2e/price.spec.ts', 'charges twice above ten', run.premium));
      await recordExecution(share('e2e/stock.spec.ts', 'holds the last one', run.plain));
      const kept = recordedChecksAt(coverageFile) as { cases?: readonly { file: string }[] } | undefined;
      expect(kept?.cases?.map((one) => one.file)).toEqual(['e2e/stock.spec.ts']);
    });
  });
});
