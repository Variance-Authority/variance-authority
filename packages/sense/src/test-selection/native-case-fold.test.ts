import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { EVALUATING, type ModuleId } from '../instrument/index.js';
import { native, nativeAvailable } from '../native.js';
import { foldCaseRun, inspectCaseRun } from './case-fold.js';
import { packCase, packFrames } from './cases.js';
import { decodeExecutionIndex } from './execution-format.js';
import eyesFrames from './eyes-frame.cjs';
import type { CapturedModule } from './instrumented-modules.js';
import preconditions from './case-preconditions.cjs';
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
  const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-native-case-fold-'));
  temporary.push(root);
  const cases = resolve(root, 'cases');
  await mkdir(cases);
  return cases;
}

/** A record store beside `cases` holding `src/branch.ts`, three regions. */
async function branchStore(cases: string): Promise<{ store: string; module: CapturedModule }> {
  const store = resolve(cases, '..', 'store');
  await mkdir(store);
  const blocks = captured('src/branch.ts', 'src/branch.ts', 3).blocks;
  const module: CapturedModule = {
    ...captured('src/branch.ts', 'src/branch.ts', 3),
    sourceDigest: digestString('source'),
    blocks: blocks.map((block) => ({ ...block, digest: digestString(`block-${block.ordinal}`) })),
  };
  await writeFile(resolve(store, 'one.rec'), Buffer.concat([segmentHeader('sense:instrument/presence-v5'), frameRecord(module)]));
  return { store, module };
}

/**
 * The native addon folds a run's frames as the JavaScript fold does: the two
 * answer the same rows from the same frames.
 */
describe.runIf(nativeAvailable())('the native case fold', () => {
  it('lays what each case said on the rows of a Jest journey artifact, as the object fold does', async () => {
    const cases = await directory();
    const file = '/repo/test/pay.test.ts';
    const level = preconditions.CASE_LEVEL;
    const owner = (name: string, said?: Parameters<typeof preconditions.packSaid>[1]) =>
      said === undefined ? packCase(file, name, name) : preconditions.packSaid(packCase(file, name, name), said);
    await writeFile(resolve(cases, 'a.vac'), packFrames([
      // The body overrides the file's `beforeEach`, and a nested one overrides it too.
      journalFormat.encodeJournal(owner('mocked', [
        ['network', 'live', `${file}:3`, 0],
        ['network', 'mocked', 'file:///repo/test/pay.test.ts:9', level],
        ['clock', 'real', `${file}:4`, 0],
        ['clock', 'frozen', `${file}:7`, 1],
      ]), new Map()),
      // Two `beforeEach` at one depth that disagree: both are kept.
      journalFormat.encodeJournal(owner('flips', [
        ['flag', 'ff-on', `${file}:12`, 1],
        ['flag', 'ff-off', `${file}:14`, 1],
        ['retries', 2, `${file}:15`, 1],
        ['retries', '2', `${file}:16`, 1],
      ]), new Map()),
      journalFormat.encodeJournal(owner('silent', []), new Map()),
      journalFormat.encodeJournal(owner('unheard'), new Map()),
    ]));
    const output = resolve(cases, '..', 'journeys.bin');

    native()!.foldJourneyTo!(cases, '/repo', [], 'sense:instrument/presence-v5', output);
    const answered = decodeExecutionIndex(await readFile(output));
    const folded = decodeExecutionIndex((await foldCaseRun(await inspectCaseRun(cases, '/repo'), new Map(), 64)).bytes);

    const row = (index: typeof folded) => Object.fromEntries(index.tests.map((test) => [test.name, test.preconditions]));
    expect(row(answered)).toEqual(row(folded));
    expect(row(answered)).toEqual({
      flips: [
        { name: 'flag', value: 'ff-off', site: 'test/pay.test.ts:14', level: 1 },
        { name: 'flag', value: 'ff-on', site: 'test/pay.test.ts:12', level: 1 },
        { name: 'retries', value: 2, site: 'test/pay.test.ts:15', level: 1 },
        { name: 'retries', value: '2', site: 'test/pay.test.ts:16', level: 1 },
      ],
      mocked: [
        { name: 'clock', value: 'frozen', site: 'test/pay.test.ts:7', level: 1 },
        { name: 'network', value: 'mocked', site: 'test/pay.test.ts:9', level },
      ],
      silent: [],
      unheard: undefined,
    });
  });

  it('steps over the Eyes frames beside the case frames of a Jest journey artifact, as the object fold does', async () => {
    const cases = await directory();
    const owner = preconditions.packSaid(packCase('/repo/test/pay.test.ts', 'pays', '1'), [
      ['network', 'mocked', '/repo/test/pay.test.ts:9', preconditions.CASE_LEVEL],
    ]);
    await writeFile(resolve(cases, 'a.vac'), packFrames([
      eyesFrames.encodeEyesFrame({ case: owner, attempt: 1 }),
      journalFormat.encodeJournal(owner, new Map([['src/pay.ts', counters(2, [1])]])),
      eyesFrames.encodeEyesFrame({ case: owner, attempt: 1, journal: { steps: ['act'] } }),
    ]));
    const output = resolve(cases, '..', 'journeys.bin');

    native()!.foldJourneyTo!(cases, '/repo', [], 'sense:instrument/presence-v5', output);
    const answered = decodeExecutionIndex(await readFile(output));
    const folded = decodeExecutionIndex((await foldCaseRun(await inspectCaseRun(cases, '/repo'), new Map(), 64)).bytes);

    const row = (index: typeof folded) => index.tests.map((test) => [test.id, test.preconditions]);
    expect(row(answered)).toEqual(row(folded));
    expect(row(answered)).toEqual([
      ['test/pay.test.ts > pays', [{ name: 'network', value: 'mocked', site: 'test/pay.test.ts:9', level: preconditions.CASE_LEVEL }]],
    ]);
  });

  it('agrees with the native compressed fold, joining a case written twice as one', async () => {
    const cases = await directory();
    const { store, module } = await branchStore(cases);
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      journalFormat.encodeJournal(
        preconditions.packSaid(
          journalFormat.settledCase(packCase('/repo/test/branch.test.ts', 'alpha', '1'), true),
          [['clock', 'frozen', '/repo/test/branch.test.ts:2', 0]],
        ),
        new Map([['src/branch.ts', counters(3, [0, 1])]]),
      ),
      journalFormat.encodeJournal(
        // A settled case with a journey and what it said: the journey is the
        // fifth field, what the case said the sixth.
        preconditions.packSaid(
          journalFormat.packJourney(journalFormat.settledCase(packCase('/repo/test/branch.test.ts', 'beta', '2'), false), 'a'.repeat(32)),
          [['network', 'mocked', '/repo/test/branch.test.ts:4', preconditions.CASE_LEVEL]],
        ),
        new Map([['src/branch.ts', counters(3, [0, 2])]]),
      ),
      // Work that outlived `alpha` wrote a second frame under its coordinate,
      // unsettled, entering a region the first did not and saying more: one case.
      journalFormat.encodeJournal(
        preconditions.packSaid(
          packCase('/repo/test/branch.test.ts', 'alpha', '1'),
          [['network', 'live', '/repo/test/branch.test.ts:8', preconditions.CASE_LEVEL]],
        ),
        new Map([['src/branch.ts', counters(3, [2])]]),
      ),
    ]));

    const run = await inspectCaseRun(cases, '/repo');
    const oracle = await foldCaseRun(run, new Map([['src/branch.ts', module]]), 64);
    const answered = native()!.foldJourney!(
      cases,
      '/repo',
      [store],
      'sense:instrument/presence-v5',
      1,
    );

    expect(decodeExecutionIndex(answered.bytes)).toEqual(decodeExecutionIndex(oracle.bytes));
    expect(decodeExecutionIndex(answered.bytes).tests).toMatchObject([
      {
        id: 'test/branch.test.ts > alpha',
        stopped: true,
        preconditions: [
          { name: 'clock', value: 'frozen' },
          { name: 'network', value: 'live' },
        ],
      },
      { id: 'test/branch.test.ts > beta' },
    ]);
    expect(answered).toMatchObject({ tests: 2, modules: 1, crossings: 5 });
  });
});
