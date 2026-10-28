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
import { openSetExecutionIndex } from './execution-set-format.js';
import { NO_OWNER } from './format-layout.js';
import eyesFrames from './eyes-frame.cjs';
import type { CapturedModule } from './instrumented-modules.js';
import preconditions from './case-preconditions.cjs';
import { rowOf } from './case-said.js';
import caseOwner from './case-owner.cjs';
import journalFormat from './journal-format.cjs';
import { nativeModule } from './jest-journey-artifact.js';

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

/** `src/branch.ts`, three regions. */
function branchModule(): CapturedModule {
  const blocks = captured('src/branch.ts', 'src/branch.ts', 3).blocks;
  const module: CapturedModule = {
    ...captured('src/branch.ts', 'src/branch.ts', 3),
    sourceDigest: digestString('source'),
    blocks: blocks.map((block) => ({ ...block, digest: digestString(`block-${block.ordinal}`) })),
  };
  return module;
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
    const owner = (name: string, said?: Parameters<typeof preconditions.packHeard>[1]['said']) =>
      said === undefined ? packCase(file, name, name) : preconditions.packHeard(packCase(file, name, name), { said: said });
    await writeFile(resolve(cases, 'a.vac'), packFrames([
      // The body overrides the file's `beforeEach`, and a nested one overrides it too.
      journalFormat.encodeJournal(owner('mocked', [
        ['fixture:network', '"live"', `${file}:3`, 0],
        ['fixture:network', '"mocked"', 'file:///repo/test/pay.test.ts:9', level],
        ['fixture:clock', '"real"', `${file}:4`, 0],
        ['fixture:clock', '"frozen"', `${file}:7`, 1],
      ]), new Map()),
      // Two `beforeEach` at one depth that disagree: both are kept.
      journalFormat.encodeJournal(owner('flips', [
        ['fixture:flag', '"ff-on"', `${file}:12`, 1],
        ['fixture:flag', '"ff-off"', `${file}:14`, 1],
        ['fixture:retries', '2', `${file}:15`, 1],
        ['fixture:retries', '"2"', `${file}:16`, 1],
      ]), new Map()),
      journalFormat.encodeJournal(owner('silent', []), new Map()),
      journalFormat.encodeJournal(owner('unheard'), new Map()),
    ]));
    const output = resolve(cases, '..', 'journeys.bin');

    native()!.foldJourneyTo!(cases, '/repo', [], output);
    const answered = decodeExecutionIndex(await readFile(output));
    const folded = decodeExecutionIndex((await foldCaseRun(await inspectCaseRun(cases, '/repo'), new Map(), 64)).bytes);

    const row = (index: typeof folded) => Object.fromEntries(index.tests.map((test) => [test.name, rowOf(test)]));
    expect(row(answered)).toEqual(row(folded));
    expect(row(answered)).toEqual({
      flips: [
        { name: 'fixture:flag', value: 'ff-off', site: 'test/pay.test.ts:14', level: 1 },
        { name: 'fixture:flag', value: 'ff-on', site: 'test/pay.test.ts:12', level: 1 },
        // Values in the code-unit order of their JSON spelling: `"2"` before `2`.
        { name: 'fixture:retries', value: '2', site: 'test/pay.test.ts:16', level: 1 },
        { name: 'fixture:retries', value: 2, site: 'test/pay.test.ts:15', level: 1 },
      ],
      mocked: [
        { name: 'fixture:clock', value: 'frozen', site: 'test/pay.test.ts:7', level: 1 },
        { name: 'fixture:network', value: 'mocked', site: 'test/pay.test.ts:9', level },
      ],
      silent: [],
      unheard: undefined,
    });
  });

  it('steps over the Eyes frames beside the case frames of a Jest journey artifact, as the object fold does', async () => {
    const cases = await directory();
    const owner = preconditions.packHeard(packCase('/repo/test/pay.test.ts', 'pays', '1'), { said: [
      ['fixture:network', '"mocked"', '/repo/test/pay.test.ts:9', preconditions.CASE_LEVEL],
    ] });
    await writeFile(resolve(cases, 'a.vac'), packFrames([
      eyesFrames.encodeEyesFrame({ case: owner, attempt: 1 }),
      journalFormat.encodeJournal(owner, new Map([['src/pay.ts', counters(2, [1])]])),
      eyesFrames.encodeEyesFrame({ case: owner, attempt: 1, journal: { steps: ['act'] } }),
    ]));
    const output = resolve(cases, '..', 'journeys.bin');

    native()!.foldJourneyTo!(cases, '/repo', [], output);
    const answered = decodeExecutionIndex(await readFile(output));
    const folded = decodeExecutionIndex((await foldCaseRun(await inspectCaseRun(cases, '/repo'), new Map(), 64)).bytes);

    const row = (index: typeof folded) => index.tests.map((test) => [test.id, rowOf(test)]);
    expect(row(answered)).toEqual(row(folded));
    expect(row(answered)).toEqual([
      ['test/pay.test.ts > pays', [{ name: 'fixture:network', value: 'mocked', site: 'test/pay.test.ts:9', level: preconditions.CASE_LEVEL }]],
    ]);
  });

  it('agrees with the native compressed fold, joining a case written twice as one', async () => {
    const cases = await directory();
    const module = branchModule();
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      journalFormat.encodeJournal(
        preconditions.packHeard(
          caseOwner.settledCase(packCase('/repo/test/branch.test.ts', 'alpha', '1'), true), { said: [['fixture:clock', '"frozen"', '/repo/test/branch.test.ts:2', 0]] },),
        new Map([['src/branch.ts', counters(3, [0, 1])]]),
      ),
      journalFormat.encodeJournal(
        // A settled case with a journey and what it said: the journey is the
        // fifth field, what the case said the sixth.
        preconditions.packHeard(
          caseOwner.packJourney(caseOwner.settledCase(packCase('/repo/test/branch.test.ts', 'beta', '2'), false), 'a'.repeat(32)), { said: [['fixture:network', '"mocked"', '/repo/test/branch.test.ts:4', preconditions.CASE_LEVEL]] },),
        new Map([['src/branch.ts', counters(3, [0, 2])]]),
      ),
      // Work that outlived `alpha` wrote a second frame under its coordinate,
      // unsettled, entering a region the first did not and saying more: one case.
      journalFormat.encodeJournal(
        preconditions.packHeard(
          packCase('/repo/test/branch.test.ts', 'alpha', '1'), { said: [['fixture:network', '"live"', '/repo/test/branch.test.ts:8', preconditions.CASE_LEVEL]] },),
        new Map([['src/branch.ts', counters(3, [2])]]),
      ),
    ]));

    const run = await inspectCaseRun(cases, '/repo');
    const oracle = await foldCaseRun(run, new Map([['src/branch.ts', module]]), 64);
    const answered = native()!.foldJourney!(
      cases,
      '/repo',
      [nativeModule(module)],
      1,
    );

    expect(decodeExecutionIndex(answered.bytes)).toEqual(decodeExecutionIndex(oracle.bytes));
    const tests = decodeExecutionIndex(answered.bytes).tests;
    expect(tests).toMatchObject([
      { id: 'test/branch.test.ts > alpha', stopped: true },
      { id: 'test/branch.test.ts > beta' },
    ]);
    expect(rowOf(tests[0]!)).toMatchObject([
      { name: 'fixture:clock', value: 'frozen' },
      { name: 'fixture:network', value: 'live' },
    ]);
    expect(answered).toMatchObject({ tests: 2, modules: 1, crossings: 5 });
  });
  it('names the region around each region, as the object fold does, and a stitch keeps it', async () => {
    const cases = await directory();
    // The module holds a function, and the function two branches.
    const captured = branchModule();
    const module: CapturedModule = {
      ...captured,
      blocks: [
        { ...captured.blocks[0]!, endLine: 9 },
        { ...captured.blocks[1]!, kind: 'function', owner: 0, endLine: 8 },
        { ...captured.blocks[2]!, owner: 1 },
        { ...captured.blocks[2]!, ordinal: 3, digest: digestString('block-3'), name: 'branch-3', path: 'branch-3', startLine: 5, endLine: 5, owner: 1 },
      ],
    };
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      journalFormat.encodeJournal(packCase('/repo/test/branch.test.ts', 'alpha', '1'), new Map([['src/branch.ts', counters(4, [0, 2])]])),
    ]));
    const output = resolve(cases, '..', 'journeys.bin');

    native()!.foldJourneyTo!(cases, '/repo', [nativeModule(module)], output);
    const owners = (bytes: Uint8Array) => openSetExecutionIndex(bytes)!.modules.map((row) => [...row.owner ?? []]);
    const oracle = await foldCaseRun(await inspectCaseRun(cases, '/repo'), new Map([['src/branch.ts', module]]), 64);

    expect(owners(await readFile(output))).toEqual(owners(oracle.bytes));
    expect(owners(await readFile(output))).toEqual([[NO_OWNER, 0, 1, 1]]);
    const stitched = resolve(cases, '..', 'stitched.bin');
    native()!.stitchJourneysTo!([output, output], stitched);
    expect(owners(await readFile(stitched))).toEqual([[NO_OWNER, 0, 1, 1]]);
  });
});
