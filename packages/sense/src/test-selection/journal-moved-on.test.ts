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

/** The file as the checkout has it once it has moved on from the text the build instrumented. */
const MOVED_ON = `// edited after the build\n${SOURCE}`;

describe('a file that moved on since the build', () => {
  it('declares a module whose text the join can no longer find', async () => {
    // The probes name a text the checkout no longer holds, so no ordinal in it
    // can be read. Dropped, the subject that entered the file would leave a
    // snapshot saying nothing about it: the change lands in `unread`, which
    // clears the skip list for every other subject in the run. Declared
    // instead, the subject that entered it is selected by name and the rest of
    // the run still skips — which is what `jest-reporter.ts` does with a module
    // its transformer never instrumented.
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const transformed = testSelectionProbes({ root }).transform(SOURCE, module)!;

      // The checkout moves on after the build: the probes were placed on a
      // text the join can no longer find.
      await writeFile(module, MOVED_ON, 'utf8');

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
        coverageFile,
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

  it('gives a module that moved on to every subject the page served', async () => {
    // The same module, and the same silence about its regions — but this time
    // the page evaluated it inside the first subject's window. An evaluating
    // module is entered once and consumed by everyone after, which the loop
    // above spends on `everyOwner` when it can read the ordinals. It cannot
    // read them here, and the answer does not change: a subject that never
    // reported the module still ran on top of it, and a change to its text is
    // a change under all of them.
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const transformed = testSelectionProbes({ root }).transform(SOURCE, module)!;

      await writeFile(module, MOVED_ON, 'utf8');

      // Not drained before the call, so the module's own evaluation is in the
      // first subject's journal and nothing at all is in the second's.
      const realm = evaluate(transformed.code);
      realm.price(20);
      const served = realm.collector.drain();
      const after = realm.collector.drain();

      await recordExecution({
        root,
        coverageFile,
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

  it('keeps the driver’s own digest for a file it declared and the join also declared', async () => {
    // Both halves name the same path and mean different texts: the driver's is
    // the text it resolved, the join's is the text on disk. A
    // precondition is read against the working tree, so the driver's is the one
    // that can be true — and two rows for one name is the duplicate the encoder
    // refuses.
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const transformed = testSelectionProbes({ root }).transform(SOURCE, module)!;

      await writeFile(module, MOVED_ON, 'utf8');

      const realm = evaluate(transformed.code);
      realm.price(20);

      await recordExecution({
        root,
        coverageFile,
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

  it('keeps a subject declared over a moved file once a later run reads the module', async () => {
    // The move costs this run every crossing in the module, and the run is
    // still whole: the subject ran, and what it ran on is declared. The cost
    // lands a generation later. A second run over the built text records the
    // module instrumented, with its own subjects' crossings and nobody
    // else's — so the merged snapshot has a row that answers this diff, which
    // is exactly what stops `unread` from widening, and a subject that entered
    // the changed branch and is nowhere in it. The declaration is the only
    // thing left standing between that subject and a green run over its own
    // change.
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const transformed = testSelectionProbes({ root }).transform(SOURCE, module)!;

      await writeFile(module, MOVED_ON, 'utf8');

      const realm = evaluate(transformed.code);
      realm.collector.drain();
      realm.price(20);
      await recordExecution({
        root,
        coverageFile,
        subjects: [{ owner: 'story:price--premium', journal: realm.collector.drain() }],
      });

      // The checkout is back on the text the build instrumented, so the module
      // reads whole.
      await writeFile(module, SOURCE, 'utf8');
      realm.price(1);
      await recordExecution({
        root,
        coverageFile,
        subjects: [{ owner: 'story:price--plain', journal: realm.collector.drain() }],
      });

      const narrowing = await narrowByExecution(coverageFile, diffAt('price.js', PREMIUM_LINE));
      expect(narrowing.unread).toEqual([]);
      expect(narrowing.entered).toContain('story:price--premium');
      expect(narrowing.whole).toContain('story:price--plain');
    });
  });
});
