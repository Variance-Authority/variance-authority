import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseLayerFiles, landCaseIndexes, type LastCaseRun } from './case-landing.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex, encodeExecutionIndex } from './execution-format.js';
import {
  encodeAsSetExecutionIndex,
  encodeSetExecutionIndex,
  openSetExecutionIndex,
  type SetExecutionModule,
} from './execution-set-format.js';

/** The regions of `src/shared.ts`, which every run here loads whole. */
const regions = ['alpha', 'beta', 'gamma'];

/** A case index as a fold writes one: each case by id, and the regions of `src/shared.ts` it called. */
function index(calls: Record<string, readonly string[]>): Buffer {
  const cases = Object.keys(calls);
  const tests = cases.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const module: SetExecutionModule = {
    file: 'src/shared.ts',
    blocks: regions.map((name, line) => ({ kind: 'function', name, path: name, startLine: line + 1, endLine: line + 1, source: true })),
    called: Uint32Array.from(regions, (name) => sets.intern(cases.flatMap((id, at) => (calls[id]!.includes(name) ? [at] : [])))),
    loaded: new Uint8Array(regions.length),
  };
  return encodeSetExecutionIndex({ tests, modules: [module], sets: sets.pool() });
}

/** The cases an index names, with the regions each called. */
async function read(file: string): Promise<Record<string, string[]>> {
  const decoded = decodeExecutionIndex(await readFile(file));
  const calls: Record<string, string[]> = Object.fromEntries(decoded.tests.map((test) => [test.id, []]));
  for (const module of decoded.modules) {
    for (const block of module.blocks) for (const crossing of block.crossings) calls[decoded.tests[crossing.test]!.id]!.push(block.name);
  }
  return calls;
}

const whole = (file: string) => ({ file, complete: true });

let root: string;
let record: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-case-landing-'));
  for (const file of ['a.test.ts', 'b.test.ts', 'c.test.ts']) await writeFile(join(root, file), '');
  record = join(root, 'coverage.bin');
  // What a local run at `l0ca1` left: `a` and `b` recorded.
  await writeFile(`${record}.cases.bin`, index({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['beta'] }));
  await writeFile(caseLayerFiles(`${record}.cases.bin`).last, JSON.stringify({
    commit: 'l0ca1', at: '2026-09-29T00:00:00.000Z', files: ['a.test.ts', 'b.test.ts'], cases: ['a.test.ts > one', 'b.test.ts > two'],
  }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('landCaseIndexes', () => {
  it('lays each shard\'s case index over the one beside the record, as the runs they were', async () => {
    // Shard 1 re-recorded `b`, whose case now calls `gamma`; shard 2 recorded `c`, which the index never had.
    await writeFile(join(root, 'shard-1.bin.cases.bin'), index({ 'b.test.ts > two': ['gamma'] }));
    await writeFile(join(root, 'shard-2.bin.cases.bin'), index({ 'c.test.ts > three': ['alpha'] }));

    const landed = await landCaseIndexes(record, root, [
      { path: join(root, 'shard-1.bin'), coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
      { path: join(root, 'shard-2.bin'), coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(landed).toEqual({ laid: `${record}.cases.bin`, shards: 2 });
    expect(await read(`${record}.cases.bin`)).toEqual({
      'a.test.ts > one': ['alpha'],
      'b.test.ts > two': ['gamma'],
      'c.test.ts > three': ['alpha'],
    });
    const layers = caseLayerFiles(`${record}.cases.bin`);
    const last = JSON.parse(await readFile(layers.last, 'utf8')) as LastCaseRun;
    // Two invocations at one commit: the runs file names both, and the before
    // layer is what the index held for their files at the local run's commit.
    expect(last).toMatchObject({ commit: 'c0ffee', before: 'l0ca1', files: ['b.test.ts', 'c.test.ts'], cases: ['c.test.ts > three'] });
    expect(await read(layers.before)).toEqual({ 'b.test.ts > two': ['beta'] });
  });

  it('removes the index and both of its layers when a shard that finished a file left no index it can lay', async () => {
    const layers = caseLayerFiles(`${record}.cases.bin`);
    await writeFile(layers.before, index({ 'a.test.ts > one': ['alpha'] }));
    // Bytes no reader in this build can decode, so no run is laid from them.
    await writeFile(join(root, 'shard-1.bin.cases.bin'), Buffer.from('not a case index'));
    const shard = join(root, 'shard-2.bin');

    const landed = await landCaseIndexes(record, root, [
      { path: join(root, 'shard-1.bin'), coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
      { path: shard, coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(landed).toEqual({ unanswered: `${record}.cases.bin`, shard: join(root, 'shard-1.bin'), removed: true });
    expect([`${record}.cases.bin`, layers.last, layers.before].filter((file) => existsSync(file))).toEqual([]);
  });

  it('lays a shard index in the row spelling, which the Playwright and Storybook seams wrote before they laid their own', async () => {
    const block = (name: string, line: number) => ({ kind: 'function', name, path: name, startLine: line, endLine: line, source: true });
    await writeFile(join(root, 'shard-1.bin.cases.bin'), encodeExecutionIndex({
      tests: [{ id: 'b.test.ts > two', file: 'b.test.ts', name: 'two' }],
      modules: [{ file: 'src/shared.ts', blocks: [
        { ...block('alpha', 1), crossings: [] },
        { ...block('beta', 2), crossings: [] },
        { ...block('gamma', 3), crossings: [{ test: 0, distance: 0 }] },
      ] }],
    }));

    const landed = await landCaseIndexes(record, root, [
      { path: join(root, 'shard-1.bin'), coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
    ]);

    expect(landed).toEqual({ laid: `${record}.cases.bin`, shards: 1 });
    expect(await read(`${record}.cases.bin`)).toEqual({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['gamma'] });
  });

  it('spells a row index as sets without losing a case, and refuses one that records a depth', () => {
    const block = { kind: 'function', name: 'alpha', path: 'alpha', startLine: 1, endLine: 1, source: true };
    const rows = {
      tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }, { id: 'a.test.ts > two', file: 'a.test.ts', name: 'two' }],
      modules: [{ file: 'src/shared.ts', blocks: [
        { ...block, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0, loaded: true }] },
        { ...block, name: 'beta', path: 'beta', loaded: true as const, crossings: [] },
      ] }],
    };

    const sets = encodeAsSetExecutionIndex(rows);

    expect(openSetExecutionIndex(sets)).toBeDefined();
    const decoded = decodeExecutionIndex(sets);
    expect(decoded.tests.map((test) => test.id)).toEqual(['a.test.ts > one', 'a.test.ts > two']);
    expect(decoded.modules[0]!.blocks.map((region) => region.crossings.map((crossing) => crossing.test))).toEqual([[0], []]);
    expect(decoded.modules[0]!.blocks.map((region) => region.loaded)).toEqual([true, true]);
    const deep = { ...rows, modules: [{ file: 'src/shared.ts', blocks: [{ ...block, crossings: [{ test: 0, distance: 2 }] }] }] };
    expect(() => encodeAsSetExecutionIndex(deep)).toThrow('src/shared.ts has a case at depth 2');
  });

  it('writes nothing when there is no index to remove', async () => {
    await rm(`${record}.cases.bin`);
    await rm(caseLayerFiles(`${record}.cases.bin`).last);
    const shard = join(root, 'shard-1.bin');

    const landed = await landCaseIndexes(record, root, [{ path: shard, coverage: { tests: [whole('b.test.ts')] } }]);

    expect(landed).toEqual({ unanswered: `${record}.cases.bin`, shard, removed: false });
    expect(existsSync(`${record}.cases.bin.lock`)).toBe(false);
    expect(existsSync(`${record}.cases.bin`)).toBe(false);
  });
});
