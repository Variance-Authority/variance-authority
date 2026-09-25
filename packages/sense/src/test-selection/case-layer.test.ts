import { describe, expect, it } from 'vitest';
import { layerCaseIndex, type CaseRunFiles } from './case-layer.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';

/** A region, the cases that called it by id, and whether it ran at load. */
type Region = readonly [name: string, callers: readonly string[], loaded?: boolean, kind?: string];

/** Spell a case index the way a fold writes one, from cases and the regions they called. */
function index(cases: readonly string[], modules: Record<string, readonly Region[]>): Buffer {
  const tests = cases.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const at = new Map(cases.map((id, position) => [id, position]));
  const spelled: SetExecutionModule[] = Object.entries(modules).map(([file, regions]) => ({
    file,
    blocks: regions.map(([name, , , kind = 'function'], line) => ({
      kind, name, path: name, startLine: line + 1, endLine: line + 1, source: true,
    })),
    called: Uint32Array.from(regions, ([, callers]) => sets.intern(callers.map((id) => at.get(id)!))),
    loaded: Uint8Array.from(regions, ([, , loaded]) => (loaded ? 1 : 0)),
  }));
  return encodeSetExecutionIndex({ tests, modules: spelled, sets: sets.pool() });
}

/** Read an index back as the cases each region names, by file and region name. */
function read(bytes: Uint8Array): { cases: string[]; regions: Record<string, Record<string, string[]>> } {
  const decoded = decodeExecutionIndex(bytes);
  return {
    cases: decoded.tests.map((test) => test.id),
    regions: Object.fromEntries(decoded.modules.map((module) => [
      module.file,
      Object.fromEntries(module.blocks.map((block) => [
        `${block.name}${block.loaded ? ' (loaded)' : ''}`,
        block.crossings.map((crossing) => decoded.tests[crossing.test]!.id),
      ])),
    ])),
  };
}

function ran(files: readonly string[], finished: readonly string[] = files, absent: readonly string[] = []): CaseRunFiles {
  return { ran: new Set(files), finished: new Set(finished), present: (file) => !absent.includes(file) };
}

const suite = index(
  ['a.test.ts > one', 'a.test.ts > two', 'b.test.ts > three'],
  {
    'src/shared.ts': [['entry', ['a.test.ts > one', 'b.test.ts > three']], ['rare', ['a.test.ts > two']]],
    'src/b-only.ts': [['only', ['b.test.ts > three']]],
  },
);

describe('layerCaseIndex', () => {
  it('replaces a file the run finished and carries every other file untouched', () => {
    const fresh = index(['a.test.ts > one'], {
      'src/shared.ts': [['entry', ['a.test.ts > one']], ['rare', []]],
    });

    const { merged } = layerCaseIndex(suite, fresh, ran(['a.test.ts']));

    expect(read(merged)).toEqual({
      cases: ['a.test.ts > one', 'b.test.ts > three'],
      regions: {
        'src/b-only.ts': { only: ['b.test.ts > three'] },
        'src/shared.ts': { entry: ['a.test.ts > one', 'b.test.ts > three'], rare: [] },
      },
    });
  });

  it('lays an unfinished file over the cases it held, which stay', () => {
    const fresh = index(['a.test.ts > one'], {
      'src/shared.ts': [['entry', ['a.test.ts > one']], ['rare', []]],
    });

    const { merged } = layerCaseIndex(suite, fresh, ran(['a.test.ts'], []));

    expect(read(merged).cases).toEqual(['a.test.ts > one', 'a.test.ts > two', 'b.test.ts > three']);
    expect(read(merged).regions['src/shared.ts']!.rare).toEqual(['a.test.ts > two']);
  });

  it('retires the cases of a test file the checkout no longer holds', () => {
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', ['a.test.ts > one']], ['rare', []]] });

    const { merged } = layerCaseIndex(suite, fresh, ran(['a.test.ts'], ['a.test.ts'], ['b.test.ts']));

    expect(read(merged)).toEqual({
      cases: ['a.test.ts > one'],
      regions: { 'src/shared.ts': { entry: ['a.test.ts > one'], rare: [] } },
    });
  });

  it('lands carried cases on the regions recorded now by address and kind, and drops the rest', () => {
    const fresh = index(['a.test.ts > one', 'a.test.ts > two'], {
      'src/shared.ts': [
        ['added', ['a.test.ts > two']],
        ['entry', ['a.test.ts > one']],
        ['rare', [], false, 'branch'],
      ],
    });

    const { merged } = layerCaseIndex(suite, fresh, ran(['a.test.ts']));

    expect(read(merged).regions['src/shared.ts']).toEqual({
      added: ['a.test.ts > two'],
      entry: ['a.test.ts > one', 'b.test.ts > three'],
      // `rare` is a branch now: nothing held under that kind, so nothing lands.
      rare: [],
    });
  });

  it('keeps what the index held for the files the run announced, loaded flags cleared', () => {
    const held = index(['a.test.ts > one', 'b.test.ts > three'], {
      'src/shared.ts': [['entry', ['a.test.ts > one', 'b.test.ts > three'], true]],
      'src/b-only.ts': [['only', ['b.test.ts > three']]],
    });
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', ['a.test.ts > one'], true]] });

    const { merged, before, last } = layerCaseIndex(held, fresh, ran(['a.test.ts']));

    expect(last).toEqual(['a.test.ts > one']);
    expect(read(merged).regions['src/shared.ts']).toEqual({
      'entry (loaded)': ['a.test.ts > one', 'b.test.ts > three'],
    });
    expect(read(before!)).toEqual({
      cases: ['a.test.ts > one'],
      regions: { 'src/shared.ts': { entry: ['a.test.ts > one'] } },
    });
  });

  it('writes the run alone, and no before, when there is no index to lay it over', () => {
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', ['a.test.ts > one']]] });

    const alone = { merged: fresh, last: ['a.test.ts > one'] };
    expect(layerCaseIndex(undefined, fresh, ran(['a.test.ts']))).toEqual(alone);
    expect(layerCaseIndex(Buffer.from('not an index'), fresh, ran(['a.test.ts']))).toEqual(alone);
  });
});
