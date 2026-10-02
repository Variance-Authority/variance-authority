import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { landCases, lastCaseRunOf } from './case-landing.js';
import type { CaseSections } from './case-record.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex, encodeExecutionIndex } from './execution-format.js';
import {
  encodeAsSetExecutionIndex,
  encodeSetExecutionIndex,
  openSetExecutionIndex,
  type SetExecutionModule,
} from './execution-set-format.js';
import { writeTestCoverage } from './index.js';

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
function read(bytes: Uint8Array | undefined): Record<string, string[]> {
  const decoded = decodeExecutionIndex(bytes!);
  const calls: Record<string, string[]> = Object.fromEntries(decoded.tests.map((test) => [test.id, []]));
  for (const module of decoded.modules) {
    for (const block of module.blocks) for (const crossing of block.crossings) calls[decoded.tests[crossing.test]!.id]!.push(block.name);
  }
  return calls;
}

const whole = (file: string) => ({ file, complete: true });

/** A shard's record, carrying the cases its seam kept. */
async function shard(name: string, cases: Uint8Array): Promise<string> {
  const at = join(root, name);
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture', tests: [], modules: [] }, { index: cases });
  return at;
}

let root: string;
let record: string;
/** What a local run at `l0ca1` left in the record: `a` and `b` recorded. */
let previous: CaseSections;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-case-landing-'));
  for (const file of ['a.test.ts', 'b.test.ts', 'c.test.ts']) await writeFile(join(root, file), '');
  record = join(root, 'coverage.bin');
  previous = {
    index: index({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['beta'] }),
    last: Buffer.from(JSON.stringify({
      commit: 'l0ca1', at: '2026-09-29T00:00:00.000Z', files: ['a.test.ts', 'b.test.ts'], cases: ['a.test.ts > one', 'b.test.ts > two'],
    })),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('landCases', () => {
  it('lays each shard\'s case index over the sections the record held, as the runs they were', async () => {
    // Shard 1 re-recorded `b`, whose case now calls `gamma`; shard 2 recorded `c`, which the index never had.
    const first = await shard('shard-1.bin', index({ 'b.test.ts > two': ['gamma'] }));
    const second = await shard('shard-2.bin', index({ 'c.test.ts > three': ['alpha'] }));

    const { landing, sections } = landCases(record, previous, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
      { path: second, coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(landing).toEqual({ laid: record, shards: 2 });
    expect(read(sections.index)).toEqual({
      'a.test.ts > one': ['alpha'],
      'b.test.ts > two': ['gamma'],
      'c.test.ts > three': ['alpha'],
    });
    // Two invocations at one commit: the last run names both, and the before
    // layer is what the index held for their files at the local run's commit.
    expect(lastCaseRunOf(sections)).toMatchObject({ commit: 'c0ffee', before: 'l0ca1', files: ['b.test.ts', 'c.test.ts'], cases: ['c.test.ts > three'] });
    expect(read(sections.before)).toEqual({ 'b.test.ts > two': ['beta'] });
  });

  it('drops the index and both of its layers when a shard that finished a file left no index it can lay', async () => {
    const held = { ...previous, before: index({ 'a.test.ts > one': ['alpha'] }) };
    // Bytes no reader in this build can decode, so no run is laid from them.
    const first = await shard('shard-1.bin', Buffer.from('not a case index'));

    const { landing, sections } = landCases(record, held, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
      { path: join(root, 'shard-2.bin'), coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(landing).toEqual({ unanswered: record, shard: first, removed: true });
    expect(sections).toEqual({});
  });

  it('lays a shard index in the row spelling, which the Playwright and Storybook seams wrote before they laid their own', async () => {
    const block = (name: string, line: number) => ({ kind: 'function', name, path: name, startLine: line, endLine: line, source: true });
    const rows = await shard('shard-1.bin', encodeExecutionIndex({
      tests: [{ id: 'b.test.ts > two', file: 'b.test.ts', name: 'two' }],
      modules: [{ file: 'src/shared.ts', blocks: [
        { ...block('alpha', 1), crossings: [] },
        { ...block('beta', 2), crossings: [] },
        { ...block('gamma', 3), crossings: [{ test: 0, distance: 0 }] },
      ] }],
    }));

    const { landing, sections } = landCases(record, previous, root, [
      { path: rows, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
    ]);

    expect(landing).toEqual({ laid: record, shards: 1 });
    expect(read(sections.index)).toEqual({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['gamma'] });
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

  it('says there was nothing to drop when the record held no cases', () => {
    const at = join(root, 'shard-1.bin');

    const { landing, sections } = landCases(record, {}, root, [{ path: at, coverage: { tests: [whole('b.test.ts')] } }]);

    expect(landing).toEqual({ unanswered: record, shard: at, removed: false });
    expect(sections).toEqual({});
  });
});
