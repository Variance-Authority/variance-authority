import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { EVALUATING, type ModuleId } from '../instrument/index.js';
import { native, nativeAvailable } from '../native.js';
import { foldCaseRun, freshCases, inspectCaseRun } from './case-fold.js';
import { layCases, lastCaseRunOf } from './case-landing.js';
import type { CaseSections } from './case-record.js';
import {
  AMBIENT,
  executionIndexFrom,
  packCase,
  packFrames,
  readCaseJournals,
} from './cases.js';
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
  const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-case-fold-'));
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

describe('the bounded case fold', () => {
  it('credits direct and ambient calls, and flags a region only a load reached', async () => {
    const cases = await directory();
    const frames = [
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', 'calls alpha', '1'),
        new Map([['src/branch.ts', counters(3, [0, 1])]]),
      ),
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', 'loads beta', '2'),
        new Map([['src/branch.ts', counters(3, [], [2])]]),
      ),
      journalFormat.encodeJournal(
        packCase('/repo/test/branch.test.ts', AMBIENT, AMBIENT),
        new Map([['src/branch.ts', counters(3, [0], [2])]]),
      ),
    ];
    await writeFile(resolve(cases, 'worker.vac'), packFrames(frames));
    const modules = new Map<ModuleId, CapturedModule>([['src/branch.ts', captured('src/branch.ts', 'src/branch.ts', 3)]]);

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
      journalFormat.encodeJournal(packCase('/repo/test/late.test.ts', 'settles', '1'), new Map([['src/late.ts', counters(3, [0], [2])]])),
      journalFormat.encodeJournal(packCase('/repo/test/late.test.ts', 'other', '2'), new Map([['src/early.ts', counters(2, [1])]])),
      journalFormat.encodeJournal(packCase('/repo/test/late.test.ts', 'settles', '1'), new Map([['src/late.ts', counters(3, [2])], ['src/early.ts', counters(2, [0])]])),
    ]));
    await writeFile(resolve(cases, 'b.vac'), packFrames([
      journalFormat.encodeJournal(packCase('/repo/test/early.test.ts', 'first', '1'), new Map([['src/early.ts', counters(2, [], [0, 1])]])),
    ]));
    const modules = new Map<ModuleId, CapturedModule>([
      ['src/late.ts', captured('src/late.ts', 'src/late.ts', 3)],
      ['src/early.ts', captured('src/early.ts', 'src/early.ts', 2)],
    ]);

    const run = await inspectCaseRun(cases, '/repo');
    const folded = await foldCaseRun(run, modules, 8);
    const previous = executionIndexFrom(await readCaseJournals(cases, '/repo'), modules);

    expect(previous.tests.map((test) => test.id)).toEqual([
      'test/early.test.ts > first', 'test/late.test.ts > other', 'test/late.test.ts > settles',
    ]);
    expect(decodeExecutionIndex(folded.bytes)).toEqual(previous);
    expect(folded.passes).toBeGreaterThan(1);

    const first = layCases({}, (await freshCases(cases, '/repo', modules, { tests: [] }))!.fresh, '/repo', { tests: [] });
    expect(decodeExecutionIndex(first.index!)).toEqual(previous);
    // The first lay has nothing to lay over: the run is the index and the last
    // run both, and there is no before.
    expect(lastCaseRunOf(first)).toMatchObject({ files: [], cases: previous.tests.map((test) => test.id) });
    expect(first.before).toBeUndefined();

    // The same run again lands over the first, and keeps what it replaced: every
    // case of a file whose cases the journals carry, announced or not.
    const again = (await freshCases(cases, '/repo', modules, {
      tests: [{ file: 'test/early.test.ts', complete: true }],
      commit: 'abc',
    }))!;
    const second = layCases(first, again.fresh, '/repo', again.run);
    expect(decodeExecutionIndex(second.index!)).toEqual(previous);
    expect(decodeExecutionIndex(second.before!).tests.map((test) => test.id))
      .toEqual(previous.tests.map((test) => test.id));
    expect(lastCaseRunOf(second)).toMatchObject({ commit: 'abc', files: ['test/early.test.ts'] });
  });

  it('names what Eyes handed each case beside its crossings, and a case that watched and crossed nothing', async () => {
    const cases = await directory();
    const crossed = packCase('/repo/test/eyes.test.ts', 'crosses', '1');
    const watched = packCase('/repo/test/eyes.test.ts', 'watches', '2');
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      journalFormat.encodeJournal(crossed, new Map([['src/branch.ts', counters(3, [0, 1])]])),
      eyesFrames.encodeEyesFrame({ case: crossed, attempt: 1, journal: { steps: ['arrange'] } }),
      eyesFrames.encodeEyesFrame({ case: crossed, attempt: 2, journal: { steps: ['act'] } }),
      // Opened and never handed over: watched, with no journal.
      eyesFrames.encodeEyesFrame({ case: watched, attempt: 1 }),
    ]));
    const modules = new Map<ModuleId, CapturedModule>([['src/branch.ts', captured('src/branch.ts', 'src/branch.ts', 3)]]);

    const run = await inspectCaseRun(cases, '/repo');

    expect(run.tests.map((test) => test.id)).toEqual(['test/eyes.test.ts > crosses', 'test/eyes.test.ts > watches']);
    expect(run.eyes).toEqual({
      watched: ['test/eyes.test.ts > crosses', 'test/eyes.test.ts > watches'],
      journals: [
        { case: 'test/eyes.test.ts > crosses', attempt: 1, journal: { steps: ['arrange'] } },
        { case: 'test/eyes.test.ts > crosses', attempt: 2, journal: { steps: ['act'] } },
      ],
    });
    // A journal is no case frame: the object fold steps over it as the bounded one does.
    const journals = await readCaseJournals(cases, '/repo');
    expect(journals.map((journal) => journal.name)).toEqual(['crosses']);
    const folded = await foldCaseRun(run, modules, 64);
    expect(decodeExecutionIndex(folded.bytes).modules).toEqual(executionIndexFrom(journals, modules).modules);
  });

  it('lays what each case said on its row, joined across its frames and named from the checkout', async () => {
    const cases = await directory();
    const file = '/repo/test/pay.test.ts';
    const level = preconditions.CASE_LEVEL;
    const owner = (name: string, said?: Parameters<typeof preconditions.packSaid>[1]) =>
      said === undefined ? packCase(file, name, name) : preconditions.packSaid(packCase(file, name, name), said);
    const entered = new Map([['src/pay.ts', counters(2, [1])]]);
    await writeFile(resolve(cases, 'a.vac'), packFrames([
      journalFormat.encodeJournal(owner('mocked', [
        ['network', 'live', `${file}:3`, 0],
        ['network', 'mocked', 'file:///repo/test/pay.test.ts:9', level],
      ]), entered),
      // A retry of the same case that said something else: the same contradiction.
      journalFormat.encodeJournal(owner('flips', [['flag', 'ff-on', `${file}:12`, level]]), entered),
      journalFormat.encodeJournal(owner('flips', [['flag', 'ff-off', `${file}:12`, level]]), new Map()),
      journalFormat.encodeJournal(owner('silent', []), entered),
      // Written by a recording that never listened.
      journalFormat.encodeJournal(owner('unheard'), entered),
    ]));
    const modules = new Map<ModuleId, CapturedModule>([['src/pay.ts', captured('src/pay.ts', 'src/pay.ts', 2)]]);

    const folded = decodeExecutionIndex((await foldCaseRun(await inspectCaseRun(cases, '/repo'), modules, 64)).bytes);

    expect(folded).toEqual(executionIndexFrom(await readCaseJournals(cases, '/repo'), modules));
    expect(Object.fromEntries(folded.tests.map((test) => [test.name, test.preconditions]))).toEqual({
      flips: [
        { name: 'flag', value: 'ff-off', site: 'test/pay.test.ts:12', level },
        { name: 'flag', value: 'ff-on', site: 'test/pay.test.ts:12', level },
      ],
      mocked: [{ name: 'network', value: 'mocked', site: 'test/pay.test.ts:9', level }],
      silent: [],
      unheard: undefined,
    });
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
      Array.from({ length: moduleCount }, (_, at) => [`src/wide-${at}.ts`, everyBlock]),
    );
    const frames = Array.from({ length: testCount }, (_, test) =>
      journalFormat.encodeJournal(
        packCase('/repo/test/wide.test.ts', `case ${test}`, `${test}`),
        entered,
      ));
    await writeFile(resolve(cases, 'worker.vac'), packFrames(frames));
    const modules = new Map<ModuleId, CapturedModule>(
      Array.from({ length: moduleCount }, (_, at) => [
        `src/wide-${at}.ts`,
        captured(`src/wide-${at}.ts`, `src/wide-${at}.ts`, blocksPerModule),
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

  it.runIf(nativeAvailable())('refuses a repeated name numbered onto a case literally named so, as the native fold does', async () => {
    const cases = await directory();
    const { store } = await branchStore(cases);
    const branch = (name: string, id: string) =>
      journalFormat.encodeJournal(packCase('/repo/test/branch.test.ts', name, id), new Map([['src/branch.ts', counters(3, [0])]]));
    await writeFile(resolve(cases, 'worker.vac'), packFrames([branch('pays', '0'), branch('pays', '1'), branch('pays#1', '2')]));
    const refusal = 'cannot number the cases of test/branch.test.ts: "pays#1" is the name of one case and the number of a repeated "pays". Rename one of them.';

    await expect(inspectCaseRun(cases, '/repo')).rejects.toThrow(refusal);
    expect(() => native()!.foldJourney!(cases, '/repo', [store], 'sense:instrument/presence-v5', 1)).toThrow(refusal);
  });

  it('keeps the base under every invocation at one commit, and names it until a file runs again', async () => {
    const cases = await directory();
    const root = resolve(cases, '..');
    // The fold retires a test file the checkout no longer holds, so each one is there.
    await mkdir(resolve(root, 'test'));
    for (const file of ['a', 'b', 'c']) await writeFile(resolve(root, 'test', `${file}.test.ts`), '');
    const modules = new Map<ModuleId, CapturedModule>([['src/x.ts', captured('src/x.ts', 'src/x.ts', 3)]]);
    let journals = 0;
    let sections: CaseSections = {};
    // One run: each test file's one case calls one branch of `src/x.ts`.
    const run = async (commit: string, calls: Readonly<Record<string, number>>): Promise<void> => {
      const from = resolve(root, `run-${journals++}`);
      await mkdir(from);
      await writeFile(resolve(from, 'w.vac'), packFrames(Object.entries(calls).map(([file, branch]) =>
        journalFormat.encodeJournal(packCase(resolve(root, 'test', file), 'case', '1'), new Map([['src/x.ts', counters(3, [branch])]])))));
      const fresh = (await freshCases(from, root, modules, {
        tests: Object.keys(calls).map((file) => ({ file: `test/${file}`, complete: true })),
        commit,
      }))!;
      sections = layCases(sections, fresh.fresh, root, fresh.run);
    };
    const before = async (): Promise<Record<string, number[]>> => {
      const held = decodeExecutionIndex(sections.before!);
      const entered: Record<string, number[]> = {};
      for (const [at, test] of held.tests.entries()) {
        entered[test.file] = held.modules.flatMap((module) =>
          module.blocks.flatMap((block, ordinal) => (block.crossings.some((crossing) => crossing.test === at) ? [ordinal] : [])));
      }
      return entered;
    };
    const last = async () => lastCaseRunOf(sections)!;

    await run('base', { 'a.test.ts': 1, 'b.test.ts': 2 });
    await run('head', { 'a.test.ts': 2 });
    expect(await before()).toEqual({ 'test/a.test.ts': [1] });
    expect(await last()).toMatchObject({ commit: 'head', before: 'base', files: ['test/a.test.ts'] });

    // A second invocation at the same commit adds its files' base, and keeps the first's.
    await run('head', { 'b.test.ts': 1 });
    expect(await before()).toEqual({ 'test/a.test.ts': [1], 'test/b.test.ts': [2] });
    expect(await last()).toMatchObject({ before: 'base', files: ['test/a.test.ts', 'test/b.test.ts'] });

    // Running a file again retires this commit's own cases of it, so the layer
    // no longer holds only the base's, and stops saying it does.
    await run('head', { 'a.test.ts': 1 });
    expect(await before()).toEqual({ 'test/a.test.ts': [2], 'test/b.test.ts': [2] });
    expect((await last()).before).toBeUndefined();
    await run('head', { 'c.test.ts': 0 });
    expect((await last()).before).toBeUndefined();

    // A new commit starts the layer again, from the run the index held.
    await run('next', { 'b.test.ts': 0 });
    expect(await before()).toEqual({ 'test/b.test.ts': [1] });
    expect(await last()).toMatchObject({ commit: 'next', before: 'head', files: ['test/b.test.ts'] });
  });

  it('names the files no index held a base for, until a run at the commit runs them again', async () => {
    // TanStack Query's first cycle: a whole run into an empty cache, then the
    // selected files again at the same commit. Only the files run again have a
    // run before them; the rest were never laid over anything.
    const cases = await directory();
    const root = resolve(cases, '..');
    await mkdir(resolve(root, 'test'));
    for (const file of ['a', 'b']) await writeFile(resolve(root, 'test', `${file}.test.ts`), '');
    const modules = new Map<ModuleId, CapturedModule>([['src/x.ts', captured('src/x.ts', 'src/x.ts', 3)]]);
    let journals = 0;
    let sections: CaseSections = {};
    const run = async (commit: string, calls: Readonly<Record<string, number>>): Promise<void> => {
      const from = resolve(root, `run-${journals++}`);
      await mkdir(from);
      await writeFile(resolve(from, 'w.vac'), packFrames(Object.entries(calls).map(([file, branch]) =>
        journalFormat.encodeJournal(packCase(resolve(root, 'test', file), 'case', '1'), new Map([['src/x.ts', counters(3, [branch])]])))));
      const fresh = (await freshCases(from, root, modules, {
        tests: Object.keys(calls).map((file) => ({ file: `test/${file}`, complete: true })),
        commit,
      }))!;
      sections = layCases(sections, fresh.fresh, root, fresh.run);
    };
    const last = async () => lastCaseRunOf(sections)!;

    await run('head', { 'a.test.ts': 1, 'b.test.ts': 1 });
    expect(sections.before).toBeUndefined();
    expect(await last()).toMatchObject({ files: ['test/a.test.ts', 'test/b.test.ts'], unbased: ['test/a.test.ts', 'test/b.test.ts'] });

    await run('head', { 'a.test.ts': 2 });
    expect(await last()).toMatchObject({ files: ['test/a.test.ts', 'test/b.test.ts'], unbased: ['test/b.test.ts'] });

    await run('head', { 'b.test.ts': 2 });
    expect((await last()).unbased).toBeUndefined();

    // A new commit lays over the index, so every file it runs has a base.
    await run('next', { 'a.test.ts': 1 });
    expect((await last()).unbased).toBeUndefined();

    // Shards landed into a fresh cache: the second brings files the first
    // never ran, and nothing before this commit recorded them either.
    sections = {};
    await run('shards', { 'a.test.ts': 1 });
    await run('shards', { 'b.test.ts': 1 });
    expect(await last()).toMatchObject({ files: ['test/a.test.ts', 'test/b.test.ts'], unbased: ['test/a.test.ts', 'test/b.test.ts'] });

    // The index still began at this commit after every unbased file has run
    // again, so a file a later run brings for the first time has no base.
    sections = {};
    await run('rerun', { 'a.test.ts': 1 });
    await run('rerun', { 'a.test.ts': 2 });
    expect((await last()).unbased).toBeUndefined();
    await run('rerun', { 'b.test.ts': 1 });
    expect(await last()).toMatchObject({ unbased: ['test/b.test.ts'] });
  });
});
