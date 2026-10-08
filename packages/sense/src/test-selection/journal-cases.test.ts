/**
 * The two things a driver can ask of the journal seam beyond a file record:
 * which individual case entered a region, and how several processes each
 * recording part of one run are joined without losing what the others saw.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeStage,
  foldStage,
  openStage,
  recordExecution,
  stageExecution,
  stagingDirectory,
  type ExecutionJournal,
} from './journal.js';
import { readTestCoverage, selectTestFiles } from './index.js';
import { coveringChange, coveringTests, ranWhileLoading, type ExecutionIndex } from './reverse.js';
import { decodeExecutionIndex } from './execution-format.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { NO_OWNER } from './format-layout.js';
import { caseIndexOf } from './case-record.js';
import preconditions from './case-preconditions.cjs';
import {
  INITIALIZING,
  LABEL_PLAIN_LINE,
  PLAIN_LINE,
  PREMIUM_LINE,
  diffAt,
  forgetThePage,
  inRoot,
  twoCases,
} from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

const named = (index: ExecutionIndex, line: number): readonly string[] =>
  coveringTests(index, { file: 'price.js', line }).map((test) => test.name);

/** Two things a case can say it arranged, as a driver hands them over and as the index lays them on its row. */
const MOCKED = ['network', 'mocked', 'e2e/price.spec.ts:3', preconditions.CASE_LEVEL] as const;
const FROZEN = ['clock', 'frozen', 'e2e/price.spec.ts:4', preconditions.CASE_LEVEL] as const;
const HEARD_MOCKED = { name: 'network', value: 'mocked', site: 'e2e/price.spec.ts:3', level: preconditions.CASE_LEVEL };
const HEARD_FROZEN = { name: 'clock', value: 'frozen', site: 'e2e/price.spec.ts:4', level: preconditions.CASE_LEVEL };

describe('a driver that can tell its cases apart', () => {
  it('names the case that walked the branch, inside the record the snapshot is', async () => {
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
      expect(await caseIndexOf(coverageFile)).toBeUndefined();

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
      expect(recorded).toMatchObject({ recorded: true, cases: 2 });

      // One record: the cases travel inside the file every rule already moves,
      // and nothing is written beside it.
      expect((await readdir(root)).filter((name) => name.startsWith('coverage.bin.'))).toEqual([]);
      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(named(index, PREMIUM_LINE)).toEqual(['charges twice above ten']);
      expect(named(index, PLAIN_LINE)).toEqual(['charges the amount below it']);
      // Each branch names the region around it, so a later run that cuts a
      // region this one never held hands it that region's cases.
      const [price] = openSetExecutionIndex((await caseIndexOf(coverageFile))!).modules;
      const around = (line: number) => price!.owner?.[price!.blocks.findLastIndex((block) => block.startLine <= line && line <= block.endLine)] ?? NO_OWNER;
      expect([around(PREMIUM_LINE), around(PLAIN_LINE)].map((owner) => price!.blocks[owner]?.name)).toEqual(['price', 'price']);
      // A selection reader opens the same record and reads it as it did.
      expect((await readTestCoverage(coverageFile))?.tests.map((test) => test.file)).toEqual(['e2e/price.spec.ts']);
    });
  });

  it('flags what the module entered while it was evaluating, and credits it to no case', async () => {
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

      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      // `label(1)` ran once, while the module evaluated, before either case
      // existed. Whichever case drained first did not earn it, and a page
      // evaluates a module once for every case it serves, so the region is
      // flagged rather than credited. The spec never imports `price.js`, so no
      // file graph names its loader either, and the answer is absent.
      const line = { file: 'price.js', line: LABEL_PLAIN_LINE };
      expect(named(index, LABEL_PLAIN_LINE)).toEqual([]);
      expect(ranWhileLoading(index, line)).toBe(true);
      const [change] = coveringChange(index, new Map([['price.js', [{ start: LABEL_PLAIN_LINE, end: LABEL_PLAIN_LINE }]]]));
      expect(change?.regions.length).toBeGreaterThan(0);
      expect(change?.regions.filter((region) => region.passengers !== undefined)).toEqual([]);
    });
  });
});

describe('a driver that records one spec file at a time', () => {
  it('keeps the cases of the spec files it did not run, and replaces those of the one it ran to the end', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      await mkdir(resolve(root, 'e2e'), { recursive: true });
      for (const spec of ['e2e/premium.spec.ts', 'e2e/plain.spec.ts']) await writeFile(resolve(root, spec), '');
      const run = twoCases(root);
      await run.write();
      const record = (file: string, name: string, journal: ExecutionJournal) =>
        recordExecution({
          root,
          cacheRoot,
          coverageFile,
          subjects: [{ owner: file, journal, complete: true }],
          cases: [{ file, name, id: name, journal }],
        });

      await record('e2e/premium.spec.ts', 'charges twice above ten', run.premium);
      await record('e2e/plain.spec.ts', 'charges the amount below it', run.plain);
      // The premium spec again, and its case now walks the plain branch.
      await record('e2e/premium.spec.ts', 'charges once below ten', run.plain);

      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(index.tests.map((test) => test.id)).toEqual([
        'e2e/plain.spec.ts > charges the amount below it',
        'e2e/premium.spec.ts > charges once below ten',
      ]);
      expect(named(index, PREMIUM_LINE)).toEqual([]);
      expect([...named(index, PLAIN_LINE)].sort()).toEqual(['charges once below ten', 'charges the amount below it']);
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
      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(named(index, PREMIUM_LINE)).toEqual(['case a']);
      expect(named(index, PLAIN_LINE)).toEqual(['case b']);

      await closeStage(directory);
      expect(stagingDirectory()).toBeUndefined();
      expect(await foldStage(directory)).toEqual({ subjects: [] });
    });
  });

  it('keeps what the runner timed and how a retry settled across the processes that staged it', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      const directory = resolve(root, '.stage');
      openStage(directory);

      // Case `a` failed in one worker and passed on its retry in another, as a
      // Playwright retry lands wherever a worker is free.
      for (const [stopped, duration] of [
        [true, 300],
        [false, 200],
      ] as const) {
        await stageExecution(directory, {
          subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium, complete: !stopped, duration }],
          cases: [{ file: 'e2e/price.spec.ts', name: 'case a', id: 'a', stopped, duration, journal: run.premium }],
        });
      }
      const staged = await foldStage(directory);
      expect(staged.subjects.map((subject) => subject.duration)).toEqual([500]);
      expect(staged.cases!.map(({ stopped, duration }) => ({ stopped, duration }))).toEqual([
        { stopped: false, duration: 500 },
      ]);

      await recordExecution({ root, cacheRoot: resolve(root, 'cache'), coverageFile, subjects: staged.subjects, cases: staged.cases! });
      expect((await readTestCoverage(coverageFile)).tests.map((test) => test.duration)).toEqual([500]);
      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(index.tests.map(({ stopped, duration }) => ({ stopped, duration }))).toEqual([{ stopped: false, duration: 500 }]);
      await closeStage(directory);
    });
  });

  it('folds the workers the same way whichever of them finished first', async () => {
    await inRoot(async (root) => {
      const run = twoCases(root);
      await run.write();
      // Six workers that each ran the same case once and disagree on all of it:
      // how it settled, what it said it arranged, what it cost, and which
      // fixture the file stood on. None can know another's clock, so the fold
      // may read nothing from which of them committed first. Six, so that a fold
      // following anything but what they wrote agrees with itself once in 720.
      const workers = Array.from({ length: 6 }, (_, at) => {
        const stopped = at % 2 === 0;
        const journal = stopped ? run.premium : run.plain;
        const attempt = `attempt ${at}`;
        return {
          subjects: [
            {
              owner: 'e2e/price.spec.ts',
              journal,
              complete: !stopped,
              duration: 0.1 * (at + 1),
              preconditions: [{ name: 'e2e/fixture.json', digest: attempt }],
            },
          ],
          cases: [
            {
              file: 'e2e/price.spec.ts',
              name: 'prices a premium line',
              id: 'e2e/price.spec.ts#1',
              stopped,
              duration: 0.1 * (at + 1),
              said: [['user', attempt, 'e2e/price.spec.ts:3:5', 0]] as [string, string, string, number][],
              journal,
            },
          ],
        };
      });
      const folded = async (name: string, order: readonly (typeof workers)[number][]): Promise<string> => {
        const directory = resolve(root, name);
        openStage(directory);
        for (const one of order) await stageExecution(directory, one);
        const fold = JSON.stringify(await foldStage(directory));
        await closeStage(directory);
        return fold;
      };
      expect(await folded('.stage-backwards', [...workers].reverse())).toBe(
        await folded('.stage-forwards', workers),
      );
    });
  });

  it('joins what a retried case said in each process, and gives attempts nobody timed no time', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();
      const directory = resolve(root, '.stage');
      openStage(directory);

      // The same case in two workers, neither timed, each saying one thing.
      for (const [journal, said] of [[run.premium, MOCKED], [run.plain, FROZEN]] as const) {
        await stageExecution(directory, {
          subjects: [{ owner: 'e2e/price.spec.ts', journal, complete: true }],
          cases: [{ file: 'e2e/price.spec.ts', name: 'case a', id: 'a', said: [said], journal }],
        });
      }
      const staged = await foldStage(directory);
      // Whichever worker's contribution is read first, the case holds both.
      expect(staged.cases!.map((observed) => observed.name)).toEqual(['case a']);
      expect(staged.cases![0]!.said).toHaveLength(2);
      expect(staged.cases![0]!.said).toEqual(expect.arrayContaining([MOCKED, FROZEN]));
      expect(staged.cases![0]).not.toHaveProperty('duration');

      await recordExecution({ root, cacheRoot: resolve(root, 'cache'), coverageFile, subjects: staged.subjects, cases: staged.cases! });
      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(index.tests[0]).not.toHaveProperty('duration');
      expect(index.tests.map((test) => test.preconditions)).toEqual([[HEARD_FROZEN, HEARD_MOCKED]]);
      expect(named(index, PREMIUM_LINE)).toEqual(['case a']);
      expect(named(index, PLAIN_LINE)).toEqual(['case a']);
      await closeStage(directory);
    });
  });

  it('joins a case a driver handed over twice: the regions of both, their time summed and what each said', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const run = twoCases(root);
      await run.write();

      await recordExecution({
        root,
        cacheRoot: resolve(root, 'cache'),
        coverageFile,
        subjects: [{ owner: 'e2e/price.spec.ts', journal: run.premium }],
        cases: [
          { file: 'e2e/price.spec.ts', name: 'case a', id: 'a', duration: 300, said: [MOCKED], journal: run.premium },
          { file: 'e2e/price.spec.ts', name: 'case a', id: 'a', duration: 200, said: [FROZEN], journal: run.plain },
          // Handed over twice and never timed: no time, rather than none summed to zero.
          { file: 'e2e/price.spec.ts', name: 'case b', id: 'b', journal: run.premium },
          { file: 'e2e/price.spec.ts', name: 'case b', id: 'b', journal: run.premium },
        ],
      });

      const index = decodeExecutionIndex((await caseIndexOf(coverageFile))!);
      expect(index.tests.map(({ name, duration, preconditions }) => ({ name, duration, preconditions }))).toEqual([
        { name: 'case a', duration: 500, preconditions: [HEARD_FROZEN, HEARD_MOCKED] },
        { name: 'case b', duration: undefined, preconditions: undefined },
      ]);
      expect(index.tests[1]).not.toHaveProperty('duration');
      // The second frame adds to the first: `case a` walked both branches.
      expect(named(index, PREMIUM_LINE)).toEqual(['case a', 'case b']);
      expect(named(index, PLAIN_LINE)).toEqual(['case a']);
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
