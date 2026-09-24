import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { EVALUATING, type ModuleId } from '../instrument/index.js';
import { native, nativeAvailable } from '../native.js';
import { foldCaseRun, inspectCaseRun, writeCaseIndex } from './case-fold.js';
import {
  AMBIENT,
  executionIndexFrom,
  packCase,
  packFrames,
  readCaseJournals,
} from './cases.js';
import { decodeExecutionIndex } from './execution-format.js';
import type { CapturedModule } from './instrumented-modules.js';
import journalFormat from './journal-format.cjs';
import { frameRecord, segmentHeader } from './record-format.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function captured(file: string, id: ModuleId, blocks: number): CapturedModule {
  return {
    file,
    id,
    sourceDigest: 'digest',
    instrumented: true,
    blocks: Array.from({ length: blocks }, (_, ordinal) => ({
      ordinal,
      kind: ordinal === 0 ? 'module' : 'branch',
      digest: `block-${ordinal}`,
      name: ordinal === 0 ? '' : `branch-${ordinal}`,
      path: ordinal === 0 ? '' : `branch-${ordinal}`,
      startLine: ordinal + 1,
      endLine: ordinal + 1,
      source: true,
      testFiles: [],
    })),
  };
}

function counters(length: number, called: readonly number[], loaded: readonly number[] = []): Uint32Array {
  const values = new Uint32Array(length);
  for (const ordinal of called) values[ordinal] = 1;
  for (const ordinal of loaded) values[ordinal] = EVALUATING + 1;
  return values;
}

async function directory(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-case-fold-'));
  temporary.push(root);
  const cases = resolve(root, 'cases');
  await mkdir(cases);
  return cases;
}

describe('the bounded case fold', () => {
  it('credits direct and ambient calls, and flags a region only a load reached', async () => {
    const cases = await directory();
    const frames = [
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', 'calls alpha', '1'),
        new Map([[7, counters(3, [0, 1])]]),
      ),
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', 'loads beta', '2'),
        new Map([[7, counters(3, [], [2])]]),
      ),
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', AMBIENT, AMBIENT),
        new Map([[7, counters(3, [0], [2])]]),
      ),
    ];
    await writeFile(resolve(cases, 'worker.vac'), packFrames(frames));
    const modules = new Map<ModuleId, CapturedModule>([[7, captured('src/branch.ts', 7, 3)]]);

    const run = await inspectCaseRun(cases, '/repo');
    const folded = await foldCaseRun(run, modules, 64);
    const decoded = decodeExecutionIndex(folded.bytes);
    const previous = executionIndexFrom(await readCaseJournals(cases, '/repo'), modules);

    expect(decoded).toEqual(previous);
    expect(folded.passes).toBe(1);
    expect(folded.crossings).toBe(3);
    expect(decoded.modules[0]?.blocks[2]).toMatchObject({ loaded: true, crossings: [] });
  });

  it('joins a case written twice, across workers and passes, as the object fold does', async () => {
    // `settles` wrote its frame, then work that outlived it wrote a second one
    // under the same coordinate, which calls what the first only loaded.
    const cases = await directory();
    await writeFile(resolve(cases, 'a.vac'), packFrames([
      journalFormat.encodeJournal(packCase('/repo/test/late.test.ts', 'settles', '1'), new Map([[7, counters(3, [0], [2])]])),
      journalFormat.encodeJournal(packCase('/repo/test/late.test.ts', 'other', '2'), new Map([[8, counters(2, [1])]])),
      journalFormat.encodeJournal(packCase('/repo/test/late.test.ts', 'settles', '1'), new Map([[7, counters(3, [2])], [8, counters(2, [0])]])),
    ]));
    await writeFile(resolve(cases, 'b.vac'), packFrames([
      journalFormat.encodeJournal(packCase('/repo/test/early.test.ts', 'first', '1'), new Map([[8, counters(2, [], [0, 1])]])),
    ]));
    const modules = new Map<ModuleId, CapturedModule>([
      [7, captured('src/late.ts', 7, 3)],
      [8, captured('src/early.ts', 8, 2)],
    ]);

    const run = await inspectCaseRun(cases, '/repo');
    const folded = await foldCaseRun(run, modules, 8);
    const previous = executionIndexFrom(await readCaseJournals(cases, '/repo'), modules);

    expect(previous.tests.map((test) => test.id)).toEqual([
      'test/early.test.ts > first', 'test/late.test.ts > other', 'test/late.test.ts > settles',
    ]);
    expect(decodeExecutionIndex(folded.bytes)).toEqual(previous);
    expect(folded.passes).toBeGreaterThan(1);

    const written = resolve(cases, '..', 'cases.bin');
    const spelled = resolve(cases, '..', 'cases.json');
    await writeCaseIndex(written, cases, '/repo', modules);
    await writeCaseIndex(spelled, cases, '/repo', modules);
    expect(decodeExecutionIndex(await readFile(written))).toEqual(previous);
    expect(JSON.parse(await readFile(spelled, 'utf8'))).toEqual(previous);
  });

  it('represents a four-million-crossing run without allocating one entry per crossing', async () => {
    const cases = await directory();
    const testCount = 2_000;
    const moduleCount = 20;
    const blocksPerModule = 100;
    const crossingCount = testCount * moduleCount * blocksPerModule;
    const everyBlock = new Uint32Array(blocksPerModule);
    everyBlock.fill(1);
    const entered = new Map<ModuleId, Uint32Array>(
      Array.from({ length: moduleCount }, (_, at) => [at + 1, everyBlock]),
    );
    const frames = Array.from({ length: testCount }, (_, test) =>
      journalFormat.encodeJournal(
        packCase('/repo/test/wide.test.ts', `case ${test}`, `${test}`),
        entered,
      ));
    await writeFile(resolve(cases, 'worker.vac'), packFrames(frames));
    const modules = new Map<ModuleId, CapturedModule>(
      Array.from({ length: moduleCount }, (_, at) => [
        at + 1,
        captured(`src/wide-${at}.ts`, at + 1, blocksPerModule),
      ]),
    );

    const run = await inspectCaseRun(cases, '/repo');
    const folded = await foldCaseRun(run, modules, 256 * 1024);

    expect(folded.crossings).toBe(crossingCount);
    expect(folded.passes).toBeGreaterThan(1);
    // The old fold held four million Map entries before encoding. Every region
    // here has the same set, so the compact artifact stores that set once.
    expect(folded.bytes.byteLength).toBeLessThan(folded.crossings / 20);
    await writeFile(resolve(cases, 'journeys.bin'), folded.bytes);
    expect((await readFile(resolve(cases, 'journeys.bin'))).byteLength).toBe(folded.bytes.byteLength);
  }, 30_000);

  it.runIf(nativeAvailable())('agrees with the native compressed fold', async () => {
    const cases = await directory();
    const store = resolve(cases, '..', 'store');
    await mkdir(store);
    const module: CapturedModule = {
      ...captured('src/branch.ts', 7, 3),
      sourceDigest: digestString('source'),
      blocks: captured('src/branch.ts', 7, 3).blocks.map((block) => ({
        ...block,
        digest: digestString(`block-${block.ordinal}`),
      })),
    };
    await writeFile(
      resolve(store, 'one.rec'),
      Buffer.concat([segmentHeader('sense:instrument/presence-v5'), frameRecord(module)]),
    );
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', 'alpha', '1'),
        new Map([[7, counters(3, [0, 1])]]),
      ),
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', 'beta', '2'),
        new Map([[7, counters(3, [0, 2])]]),
      ),
    ]));

    const run = await inspectCaseRun(cases, '/repo');
    const oracle = await foldCaseRun(run, new Map([[7, module]]), 64);
    const answered = native()!.foldJourney!(
      cases,
      '/repo',
      [store],
      'sense:instrument/presence-v5',
      1,
    );

    expect(decodeExecutionIndex(answered.bytes)).toEqual(decodeExecutionIndex(oracle.bytes));
    expect(answered).toMatchObject({ tests: 2, modules: 1, crossings: 4 });
  });
});
