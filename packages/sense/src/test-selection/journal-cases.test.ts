/**
 * The two things a driver can ask of the journal seam beyond a file record:
 * which individual case entered a region, and how several processes each
 * recording part of one run are joined without losing what the others saw.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeStage,
  foldStage,
  openStage,
  recordExecution,
  stageExecution,
  stagingDirectory,
  testSelectionProbes,
  type ExecutionJournal,
} from './journal.js';
import { selectTestFiles } from './index.js';
import { coveringTests, type ExecutionIndex } from './reverse.js';
import { decodeExecutionIndex } from './execution-format.js';
import {
  INITIALIZING,
  LABEL_PLAIN_LINE,
  PLAIN_LINE,
  PREMIUM_LINE,
  SOURCE,
  diffAt,
  evaluate,
  forgetThePage,
  inRoot,
} from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

/** The two branches of the fixture module, drained a case at a time. */
function twoCases(root: string, source = SOURCE): {
  readonly premium: ExecutionJournal;
  readonly plain: ExecutionJournal;
  readonly write: () => Promise<void>;
} {
  const module = resolve(root, 'price.js');
  const plugin = testSelectionProbes({ root, cacheRoot: resolve(root, 'cache') });
  let premium!: ExecutionJournal;
  let plain!: ExecutionJournal;
  return {
    get premium() {
      return premium;
    },
    get plain() {
      return plain;
    },
    write: async () => {
      await writeFile(module, source, 'utf8');
      const realm = evaluate(plugin.transform(source, module)!.code);
      realm.price(20);
      premium = realm.collector.drain();
      realm.price(1);
      plain = realm.collector.drain();
    },
  };
}

const named = (index: ExecutionIndex, line: number): readonly string[] =>
  coveringTests(index, { file: 'price.js', line }).map((test) => test.name);

describe('a driver that can tell its cases apart', () => {
  it('names the case that walked the branch, beside a snapshot that is unchanged', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();

      const subjects = [
        { owner: 'e2e/price.spec.ts', journal: run.premium },
        { owner: 'e2e/price.spec.ts', journal: run.plain },
      ];
      const without = await recordExecution({ root, cacheRoot, coverageFile, subjects });
      expect(without).toMatchObject({ recorded: true });
      const snapshot = await readFile(coverageFile);
      expect(await readFile(`${coverageFile}.cases.bin`).catch(() => undefined)).toBeUndefined();

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects,
        cases: [
          { file: 'e2e/price.spec.ts', name: 'charges twice above ten', id: 'a', journal: run.premium },
          { file: 'e2e/price.spec.ts', name: 'charges the amount below it', id: 'b', journal: run.plain },
        ],
      });
      expect(recorded).toMatchObject({
        recorded: true,
        cases: 2,
        executionFile: `${coverageFile}.cases.bin`,
      });

      // The snapshot a `--since` reads is the same bytes either way: what the
      // index costs is a second file, and a reader that never opens it pays
      // nothing for it.
      expect(await readFile(coverageFile)).toEqual(snapshot);

      const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
      expect(named(index, PREMIUM_LINE)).toEqual(['charges twice above ten']);
      expect(named(index, PLAIN_LINE)).toEqual(['charges the amount below it']);
    });
  });

  it('credits every case with what the module entered while it was evaluating', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root, INITIALIZING);
      await run.write();

      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }],
        cases: [
          { file: 'e2e/price.spec.ts', name: 'above ten', id: 'a', journal: run.premium },
          { file: 'e2e/price.spec.ts', name: 'below ten', id: 'b', journal: run.plain },
        ],
      });

      const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
      // `label(1)` ran once, while the module evaluated, before either case
      // existed. Whichever case drained first did not earn it and the other
      // ones did not miss it: a module evaluates once per realm, so the region
      // belongs to every case of the file or the index under-credits — the one
      // direction selection may not go.
      expect(named(index, LABEL_PLAIN_LINE)).toEqual(['above ten', 'below ten']);
    });
  });
});

describe('a run recorded by more than one process', () => {
  it('loses half of a spec file when each process merges for itself', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();

      // Two workers, one spec file: `fullyParallel`, a second project, a shard,
      // or a retry that landed elsewhere. Each says the file finished, because
      // from inside a worker it did.
      for (const journal of [run.premium, run.plain]) {
        await recordExecution({
          root,
          cacheRoot,
          coverageFile,
          subjects: [{ owner: 'e2e/price.spec.ts', journal, complete: true }],
        });
      }

      // The second merge retired the first's crossings. Nothing failed and the
      // record says the file was walked whole, so the branch the first worker
      // walked is now a line the next `--since` skips.
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PLAIN_LINE))).toEqual([
        'e2e/price.spec.ts',
      ]);
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PREMIUM_LINE))).toEqual([]);
    });
  });

  it('keeps both halves when the processes stage and one fold merges', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();

      const directory = resolve(root, '.stage');
      openStage(directory);
      expect(stagingDirectory()).toBe(directory);

      for (const [journal, id] of [
        [run.premium, 'a'],
        [run.plain, 'b'],
      ] as const) {
        // What a worker does: it writes what it saw and merges nothing.
        await stageExecution(stagingDirectory()!, {
          subjects: [{ owner: 'e2e/price.spec.ts', journal, complete: true }],
          cases: [{ file: 'e2e/price.spec.ts', name: `case ${id}`, id, journal }],
        });
      }

      const staged = await foldStage(directory);
      // One row per owner, because two rows for one owner is the duplicate the
      // encoder refuses — and because they are one observation of one file.
      expect(staged.subjects).toHaveLength(1);
      expect(staged.cases).toHaveLength(2);

      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: staged.subjects,
        cases: staged.cases!,
      });

      for (const line of [PREMIUM_LINE, PLAIN_LINE]) {
        expect(await selectTestFiles(coverageFile, diffAt('price.js', line))).toEqual([
          'e2e/price.spec.ts',
        ]);
      }
      const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
      expect(named(index, PREMIUM_LINE)).toEqual(['case a']);
      expect(named(index, PLAIN_LINE)).toEqual(['case b']);

      await closeStage(directory);
      expect(stagingDirectory()).toBeUndefined();
      expect(await foldStage(directory)).toEqual({ subjects: [] });
    });
  });

  it('reads nothing from a run that died before its fold', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, '.stage');
      const run = twoCases(root);
      await run.write();

      openStage(directory);
      await stageExecution(directory, {
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium, complete: true }],
      });
      // The next run opens the same directory. What the killed one left behind
      // is evidence of executions that did not happen, at a commit nobody
      // recorded, so it is emptied rather than trusted.
      openStage(directory);
      expect(await foldStage(directory)).toMatchObject({ subjects: [] });
      await closeStage(directory);
    });
  });
});
