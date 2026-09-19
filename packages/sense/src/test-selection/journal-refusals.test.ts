/**
 * What the journal seam declines to record, and what it says instead.
 *
 * Every case here ends with no snapshot written, which is the safe direction:
 * a run that cannot be joined honestly costs the next selection its narrowing
 * and nothing else. What the refusal has to carry is the sentence that names
 * the cause, because the alternative — a snapshot saying every subject reaches
 * no source — is green, silent, and wrong.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testSelectionProbes, recordExecution } from './journal.js';
import { instrumentationId } from '../instrument/index.js';
import { readTestCoverage } from './index.js';
import { SOURCE, evaluate, forgetThePage, inRoot } from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

describe('a browser run that cannot be joined records nothing', () => {
  it('refuses a journal cut by another probe recipe than the one it is folding', async () => {
    // A snapshot names the recipe its ordinals were cut by, and a merge
    // discards a layer cut by a different one. Two seams recording one index
    // under two recipes would each wipe the other every run, silently, so the
    // mismatch is refused where it is still readable.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot, mode: 'entries' });
      const transformed = plugin.transform(SOURCE, module)!;
      // The collector the plugin's own `load` answers with, as a page would
      // have it: the recipe is stamped on what the page reports, not only on
      // what the store holds.
      const realm = evaluate(transformed.code, 'entries');
      realm.price(20);
      const journal = realm.collector.drain();
      const subjects = [{ owner: 'story:price--premium', journal }];

      const mismatched = await recordExecution({ root, cacheRoot, coverageFile, subjects });
      expect(mismatched.recorded).toBe(false);
      expect(mismatched.because).toContain('entries');

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects,
        mode: 'entries',
      });
      expect(recorded).toMatchObject({ recorded: true, subjects: 1 });
      expect((await readTestCoverage(coverageFile)).instrumentation).toContain('entries');
    });
  });

  it('says so when it observed subjects and placed no module at all', async () => {
    // A seam that never engaged writes a snapshot saying every subject reaches
    // no source, and every selection from it narrows to nothing. Said once,
    // where the recording ends.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const warned: string[] = [];
      const warn = console.warn;
      console.warn = (message: string): void => void warned.push(message);
      try {
        await recordExecution({
          root,
          cacheRoot,
          coverageFile,
          subjects: [
            {
              owner: 'story:price--premium',
              journal: { instrumentation: instrumentationId(), modules: [] },
            },
          ],
        });
      } finally {
        console.warn = warn;
      }
      expect(warned.join('\n')).toContain('instrumented 0 modules');
    });
  });

  it('records nothing, and says why, when the page names a module no store holds', async () => {
    // The page is instrumented and reports ordinals; what is missing is the
    // record that says which regions those ordinals are. Joining anyway would
    // put crossings in regions nobody cut.
    await inRoot(async (root) => {
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot: resolve(root, 'cache') });
      const transformed = plugin.transform(SOURCE, module)!;

      const realm = evaluate(transformed.code);
      realm.price(20);
      const recorded = await recordExecution({
        root,
        cacheRoot: resolve(root, 'another-cache'),
        coverageFile: resolve(root, 'coverage.bin'),
        subjects: [{ owner: 'story:price--premium', journal: realm.collector.drain() }],
      });

      expect(recorded.recorded).toBe(false);
      expect(recorded.because).toContain('no source identity');
      expect(recorded.because).toContain(resolve(root, 'another-cache'));
    });
  });

  it('refuses a page whose probe recipe is not this driver’s', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      const plugin = testSelectionProbes({ root, cacheRoot });
      plugin.transform(SOURCE, module);

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile: resolve(root, 'coverage.bin'),
        subjects: [
          {
            owner: 'story:price--premium',
            journal: { instrumentation: 'sense:instrument/presence-v1', modules: [] },
          },
        ],
      });

      expect(recorded.recorded).toBe(false);
      expect(recorded.because).toContain('different versions');
    });
  });
});
