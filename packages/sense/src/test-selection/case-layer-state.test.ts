import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CaseLayerState } from './case-layer-state.js';
import { Translation } from './set-translation.js';
import { landCases } from './case-landing.js';
import { lineAt, linesOf, lineValue } from './case-lines.js';
import { NO_OWNER } from './format-layout.js';
import { CrossingSets } from './crossing-sets.js';
import * as Format from './execution-set-format.js';
import { writeTestCoverage } from './index.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it('writes the final case columns once for seeded shard landing, rather than every growing prefix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'variance-case-fan-in-'));
  roots.push(root);
  const index = (file: string) => {
    const sets = new CrossingSets(1);
    const called = sets.intern([0]);
    return Format.encodeSetExecutionIndex({ tests: [{ id: `${file} > one`, file, name: 'one' }], sets: sets.pool(), modules: [{ file: 'shared.ts',
      blocks: [{ kind: 'function', name: 'shared', path: 'shared', startLine: 1, endLine: 2, source: true }],
      called: Uint32Array.of(called), loaded: Uint8Array.of(0) }] });
  };
  await writeFile(join(root, 'base.test.ts'), '');
  const baseTests = ['base.test.ts', ...Array.from({ length: 8 }, (_, at) => `${at}.test.ts`)].map((file) => ({ id: `${file} > old`, file, name: 'old' }));
  const baseSets = new CrossingSets(baseTests.length);
  const baseCalled = baseSets.intern(baseTests.map((_, at) => at));
  const previous = { index: Format.encodeSetExecutionIndex({ tests: baseTests, sets: baseSets.pool(), modules: [{ file: 'shared.ts',
    blocks: [{ kind: 'function', name: 'shared', path: 'shared', startLine: 1, endLine: 2, source: true }],
    called: Uint32Array.of(baseCalled), loaded: Uint8Array.of(0) }] }) };
  const shards = [];
  for (let at = 0; at < 8; at += 1) {
    const file = `${at}.test.ts`;
    await writeFile(join(root, file), '');
    const path = join(root, `${at}.bin`);
    const coverage = { version: 3 as const, instrumentation: 'fixture', commit: 'head', tests: [{ file, complete: true, preconditions: [] }],
      modules: [{ file: 'shared.ts', sourceDigest: 'same' }] };
    await writeTestCoverage(path, { ...coverage, modules: [] }, { index: index(file) });
    shards.push({ path, coverage });
  }
  const writer = vi.spyOn(Format, 'writeSetColumns');
  const { sections } = landCases(join(root, 'combined.bin'), previous, root, shards, new Map([['shared.ts', 'same']]));
  expect(Format.openSetExecutionIndex(sections.index!)!.tests).toHaveLength(9);
  expect(Format.openSetExecutionIndex(sections.before!)!.tests).toHaveLength(8);
  expect(writer).toHaveBeenCalledTimes(2);
});

it('takes the before of a repeated file from earlier shards when the landing began without an index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'variance-case-repeat-'));
  roots.push(root);
  const file = 'repeat.test.ts';
  await writeFile(join(root, file), '');
  const shards = [];
  for (const name of ['old', 'new']) {
    const sets = new CrossingSets(1);
    const called = sets.intern([0]);
    const index = Format.encodeSetExecutionIndex({ tests: [{ id: `${file} > ${name}`, file, name }], sets: sets.pool(), modules: [{ file: 'shared.ts',
      blocks: [{ kind: 'function', name: 'shared', path: 'shared', startLine: 1, endLine: 2, source: true }], called: Uint32Array.of(called), loaded: Uint8Array.of(0) }] });
    const path = join(root, `${name}.bin`);
    const coverage = { version: 3 as const, instrumentation: 'fixture', commit: 'same', tests: [{ file, complete: true, preconditions: [] }], modules: [] };
    await writeTestCoverage(path, coverage, { index });
    shards.push({ path, coverage });
  }
  const { sections } = landCases(join(root, 'combined.bin'), {}, root, shards);
  expect(Format.openSetExecutionIndex(sections.index!)!.tests.map((test) => test.name)).toEqual(['new']);
  expect(Format.openSetExecutionIndex(sections.before!)!.tests.map((test) => test.name)).toEqual(['old']);
});

it('translates shared input sets and the final union once, regardless of the number of regions naming them', () => {
  const state = new CaseLayerState();
  const mapper = vi.spyOn(Object.getPrototypeOf(Translation.deferred(() => true)), 'mapped');
  for (const file of ['a.test.ts', 'b.test.ts']) {
    const sets = new CrossingSets(1);
    const called = sets.intern([0]);
    const bytes = Format.encodeSetExecutionIndex({ tests: [{ id: `${file} > one`, file, name: 'one' }], sets: sets.pool(), modules: [{ file: 'shared.ts',
      blocks: Array.from({ length: 1024 }, (_, at) => ({ kind: 'function', name: 'shared', path: 'shared', startLine: at + 1, endLine: at + 1, source: true })),
      called: new Uint32Array(1024).fill(called), loaded: new Uint8Array(1024) }] });
    const opened = Format.openSetExecutionIndex(bytes)!;
    const members = vi.spyOn(opened.sets, 'members');
    state.layIndex(opened, { ran: new Set([file]), finished: new Set([file]), present: () => true });
    expect(members).toHaveBeenCalledTimes(1);
  }
  const joined = Format.openSetExecutionIndex(state.finish())!;
  expect(joined.tests).toHaveLength(2);
  expect(joined.sets.members(joined.modules[0]!.called[0]!)).toEqual(Uint32Array.of(0, 1));
  expect(mapper).toHaveBeenCalledTimes(1);
});

it('combines named artifact cases even when their test paths are absent from the current checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'variance-case-artifacts-'));
  roots.push(root);
  const shards = [];
  for (const file of ['a.test.ts', 'b.test.ts']) {
    const sets = new CrossingSets(1);
    sets.intern([]);
    const index = Format.encodeSetExecutionIndex({ tests: [{ id: `${file} > one`, file, name: 'one' }], sets: sets.pool(), modules: [] });
    const path = join(root, `${file}.bin`);
    const coverage = { version: 3 as const, instrumentation: 'fixture', commit: 'same', tests: [{ file, complete: true, preconditions: [] }], modules: [] };
    await writeTestCoverage(path, coverage, { index });
    shards.push({ path, coverage });
  }
  const { sections } = landCases(join(root, 'combined.bin'), {}, root, shards, undefined, undefined, undefined, () => true);
  expect(Format.openSetExecutionIndex(sections.index!)!.tests.map((test) => test.file)).toEqual(['a.test.ts', 'b.test.ts']);
});

it('retires cases by their current file when a producer keeps an identity across a file move', () => {
  const state = new CaseLayerState();
  const lay = (file: string, tests: readonly { id: string; file: string; name: string }[]) => {
    const sets = new CrossingSets(tests.length); sets.intern([]);
    const index = Format.openSetExecutionIndex(Format.encodeSetExecutionIndex({ tests, modules: [], sets: sets.pool() }))!;
    state.layIndex(index, { ran: new Set([file]), finished: new Set([file]), present: () => true });
  };
  lay('a.test.ts', [{ id: 'stable', file: 'a.test.ts', name: 'one' }]);
  lay('b.test.ts', [{ id: 'stable', file: 'b.test.ts', name: 'one' }]);
  lay('a.test.ts', []);
  expect(Format.openSetExecutionIndex(state.finish())!.tests).toEqual([{ id: 'stable', file: 'b.test.ts', name: 'one' }]);
});

it.each(['complete', 'partial'])('keeps recorded ownership when a later artifact did not collect it: %s', (cut) => {
  const state = new CaseLayerState();
  const blocks = [
    { kind: 'module', name: 'shared', path: '', startLine: 1, endLine: 3, source: true },
    { kind: 'function', name: 'child', path: 'child', startLine: 2, endLine: 2, source: true },
  ];
  for (const [at, file] of ['a.test.ts', 'b.test.ts'].entries()) {
    const sets = new CrossingSets(1); const called = sets.intern([0]);
    const partial = at === 1 && cut === 'partial';
    const bytes = Format.encodeSetExecutionIndex({ tests: [{ id: file, file, name: 'one' }], sets: sets.pool(), modules: [{ file: 'shared.ts',
      blocks: partial ? blocks.slice(1) : blocks, called: partial ? Uint32Array.of(called) : Uint32Array.of(0, called), loaded: new Uint8Array(partial ? 1 : 2),
      ...(at === 0 ? { owner: Uint32Array.of(NO_OWNER, 0) } : {}),
    }] });
    state.layIndex(Format.openSetExecutionIndex(bytes)!, { ran: new Set([file]), finished: new Set([file]), artifacts: true, present: () => { throw new Error('artifact mode cannot consult a checkout'); } });
  }
  const joined = Format.openSetExecutionIndex(state.finish())!;
  expect(joined.modules[0]!.blocks.map((block) => block.name)).toEqual(['shared', 'child']);
  expect(joined.modules[0]!.owner).toEqual(Uint32Array.of(NO_OWNER, 0));
  expect(joined.sets.members(joined.modules[0]!.called[1]!)).toEqual(Uint32Array.of(0, 1));
});

it.each([
  [lineValue(10, false), lineValue(20, false), undefined],
  [lineValue(10, true), lineValue(20, false), { line: 20, ambient: false }],
  [lineValue(20, false), lineValue(10, true), { line: 20, ambient: false }],
  [lineValue(20, false), lineValue(20, false), { line: 20, ambient: false }],
  [lineValue(20, false), lineValue(10, false), undefined],
  [undefined, lineValue(20, false), undefined],
  [lineValue(20, false), undefined, undefined],
] as const)('combines first-entry evidence without inventing chronology: %s / %s', (first, second, expected) => {
  const state = new CaseLayerState();
  for (const value of [first, second]) {
    const sets = new CrossingSets(1); const called = sets.intern([0]);
    const bytes = Format.encodeSetExecutionIndex({ tests: [{ id: 'same', file: 'same.test.ts', name: 'one' }], sets: sets.pool(), modules: [{ file: 'shared.ts',
      blocks: [{ kind: 'function', name: 'one', path: 'one', startLine: 1, endLine: 1, source: true }], called: Uint32Array.of(called), loaded: Uint8Array.of(0),
    }], ...(value === undefined ? {} : { lines: [{ table: [value], fallback: value, segments: new Map() }] }) });
    state.layIndex(Format.openSetExecutionIndex(bytes)!, { ran: new Set(), finished: new Set(), artifacts: true, present: () => true });
  }
  const joined = Format.openSetExecutionIndex(state.finish())!;
  const lines = linesOf(joined.lines, 0);
  expect(lines === undefined ? undefined : lineAt(lines, 0, 0)).toEqual(expected);
  expect(joined.sets.members(joined.modules[0]!.called[0]!)).toEqual(Uint32Array.of(0));
});
