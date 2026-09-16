import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testSelectionProbes, recordExecution } from './journal.js';
import { narrowByExecution, readTestCoverage } from './index.js';
import {
  PREMIUM_LINE,
  SOURCE,
  diffAt,
  evaluate,
  forgetThePage,
  inRoot,
} from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

describe('two builds of one repository, cut from different texts', () => {
  it('declares a module two builds cut differently, which no row of theirs can speak for', async () => {
    // Two builds of one repository instrument the same path and disagree about
    // the text it was cut from, so `readRecords` hands it back with no blocks
    // and the crossings loop above drops it. What was left was a subject that
    // entered a file and a snapshot saying nothing about it: the change landed
    // in `unread`, which clears the skip list for every other subject in the
    // run. Declared instead, the subject that entered it is selected by name
    // and the rest of the run still skips — which is what `jest-reporter.ts`
    // has always done with the same module.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const app = testSelectionProbes({ root, cacheRoot, label: 'app' });
      const transformed = app.transform(SOURCE, module)!;

      // The same path, instrumented by a second build against a different text
      // — a generated module, or a worktree the other build is checked out at.
      // The digest is of the text on disk (`probes.ts`), so the disk is what has
      // to move between the two.
      await writeFile(module, `// the other build's copy of this file\n${SOURCE}`, 'utf8');
      const preview = testSelectionProbes({ root, cacheRoot, label: 'preview' });
      preview.transform(`// the other build's copy of this file\n${SOURCE}`, module);
      await writeFile(module, SOURCE, 'utf8');

      // Drained first, so what the module crossed while it was evaluating is
      // nobody's here. That crossing belongs to every subject the page served,
      // and the test below is the one that says so.
      const realm = evaluate(transformed.code);
      realm.collector.drain();
      realm.price(20);
      const premium = realm.collector.drain();
      const elsewhere = realm.collector.drain();

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        label: 'app',
        heads: ['preview'],
        subjects: [
          { owner: 'story:price--premium', journal: premium },
          { owner: 'story:price--elsewhere', journal: elsewhere },
        ],
      });
      expect(recorded).toMatchObject({ recorded: true, subjects: 2 });

      const narrowing = await narrowByExecution(coverageFile, diffAt('price.js', PREMIUM_LINE));
      expect(narrowing.unread).toEqual([]);
      expect(narrowing.entered).toEqual(['story:price--premium']);
      expect(narrowing.whole).toContain('story:price--elsewhere');
    });
  });

  it('gives a module two builds cut differently to every subject the page served', async () => {
    // The same module, and the same silence about its regions — but this time
    // the page evaluated it inside the first subject's window. An evaluating
    // module is entered once and consumed by everyone after, which the loop
    // above spends on `everyOwner` when it can read the ordinals. It cannot
    // read them here, and the answer does not change: a subject that never
    // reported the module still ran on top of it, and a change to its text is
    // a change under all of them.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const app = testSelectionProbes({ root, cacheRoot, label: 'app' });
      const transformed = app.transform(SOURCE, module)!;

      await writeFile(module, `// the other build's copy of this file\n${SOURCE}`, 'utf8');
      const preview = testSelectionProbes({ root, cacheRoot, label: 'preview' });
      preview.transform(`// the other build's copy of this file\n${SOURCE}`, module);
      await writeFile(module, SOURCE, 'utf8');

      // Not drained before the call, so the module's own evaluation is in the
      // first subject's journal and nothing at all is in the second's.
      const realm = evaluate(transformed.code);
      realm.price(20);
      const served = realm.collector.drain();
      const after = realm.collector.drain();

      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        label: 'app',
        heads: ['preview'],
        subjects: [
          { owner: 'story:price--served', journal: served },
          { owner: 'story:price--after', journal: after },
        ],
      });

      const narrowing = await narrowByExecution(coverageFile, diffAt('price.js', PREMIUM_LINE));
      expect(narrowing.unread).toEqual([]);
      expect(narrowing.entered).toEqual(['story:price--after', 'story:price--served']);
    });
  });

  it('keeps the driver’s own digest for a file it declared and the stores also answered for', async () => {
    // Both halves name the same path and mean different texts: the driver's is
    // the text it resolved, the store's is the text a build was cut from. A
    // precondition is read against the working tree, so the driver's is the one
    // that can be true — and two rows for one name is the duplicate the encoder
    // refuses.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const app = testSelectionProbes({ root, cacheRoot, label: 'app' });
      const transformed = app.transform(SOURCE, module)!;

      await writeFile(module, `// the other build's copy of this file\n${SOURCE}`, 'utf8');
      const preview = testSelectionProbes({ root, cacheRoot, label: 'preview' });
      preview.transform(`// the other build's copy of this file\n${SOURCE}`, module);
      await writeFile(module, SOURCE, 'utf8');

      const realm = evaluate(transformed.code);
      realm.price(20);

      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        label: 'app',
        heads: ['preview'],
        subjects: [
          {
            owner: 'story:price--premium',
            journal: realm.collector.drain(),
            preconditions: [{ name: 'price.js', digest: 'what-the-driver-resolved' }],
          },
        ],
      });

      const coverage = await readTestCoverage(coverageFile);
      expect(coverage.tests).toEqual([
        {
          file: 'story:price--premium',
          complete: true,
          preconditions: [{ name: 'price.js', digest: 'what-the-driver-resolved' }],
        },
      ]);
    });
  });

  it('keeps a subject the stores disagreed about once a later run agrees about the module', async () => {
    // The disagreement costs this run every crossing in the module, and the
    // run is still whole: the subject ran, and what it ran on is declared. The
    // cost lands a generation later. A second run whose stores agree records
    // the module instrumented, with its own subjects' crossings and nobody
    // else's — so the merged snapshot has a row that answers this diff, which
    // is exactly what stops `unread` from widening, and a subject that entered
    // the changed branch and is nowhere in it. The declaration is the only
    // thing left standing between that subject and a green run over its own
    // change.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const app = testSelectionProbes({ root, cacheRoot, label: 'app' });
      const transformed = app.transform(SOURCE, module)!;

      await writeFile(module, `// the other build's copy of this file\n${SOURCE}`, 'utf8');
      const preview = testSelectionProbes({ root, cacheRoot, label: 'preview' });
      preview.transform(`// the other build's copy of this file\n${SOURCE}`, module);
      await writeFile(module, SOURCE, 'utf8');

      const realm = evaluate(transformed.code);
      realm.collector.drain();
      realm.price(20);
      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        label: 'app',
        heads: ['preview'],
        subjects: [{ owner: 'story:price--premium', journal: realm.collector.drain() }],
      });

      // The page the second run drove is the one build, so the peer that
      // disagreed is not among its stores and the module reads whole.
      realm.price(1);
      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        label: 'app',
        subjects: [{ owner: 'story:price--plain', journal: realm.collector.drain() }],
      });

      const narrowing = await narrowByExecution(coverageFile, diffAt('price.js', PREMIUM_LINE));
      expect(narrowing.unread).toEqual([]);
      expect(narrowing.entered).toContain('story:price--premium');
      expect(narrowing.whole).toContain('story:price--plain');
    });
  });
});
