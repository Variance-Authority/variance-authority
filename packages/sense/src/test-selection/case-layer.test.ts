import { describe, expect, it, vi } from 'vitest';
import { layerCaseIndex, type CaseRunFiles } from './case-layer.js';
import { caseMotion } from './case-motion.js';
import { coverageChange } from './coverage-count.js';
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

    const alone = { merged: fresh, last: ['a.test.ts > one'], announced: ['a.test.ts > one'] };
    for (const previous of [undefined, Buffer.from('not an index')]) {
      const { cases, ...layers } = layerCaseIndex(previous, fresh, ran(['a.test.ts']));
      expect(layers).toEqual(alone);
      expect(cases()).toEqual(['a.test.ts > one']);
    }
  });

  it('reads no string of a case or region the run did not touch, and asks once a file whether it is present', () => {
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', ['a.test.ts > one']]] });
    const layered = (untouched: number): { readonly decoded: number; readonly asked: number } => {
      const kept = Array.from({ length: untouched }, (_, at) => `kept.test.ts > case ${at}`);
      const held = index([...kept, 'a.test.ts > one'], {
        'src/shared.ts': [['entry', ['a.test.ts > one']]],
        ...Object.fromEntries(kept.map((id, at) => [`src/kept-${at}.ts`, [['entry', [id]], ['idle', []]]])),
      });
      let asked = 0;
      const decode = vi.spyOn(TextDecoder.prototype, 'decode');
      try {
        layerCaseIndex(held, fresh, { ...ran(['a.test.ts']), present: () => (asked += 1) > 0 });
        return { decoded: decode.mock.calls.length, asked };
      } finally {
        decode.mockRestore();
      }
    };

    expect(layered(400)).toEqual(layered(10));
  });
});

/** A region at one line, the cases that called it, and its name when it is not the callback's. */
type Cut = readonly [line: number, callers: readonly string[], name?: string];

/** One module cut at the lines given, each region a one-line callback its callers entered. */
function cutAt(cases: readonly string[], file: string, regions: readonly Cut[]): Buffer {
  const tests = cases.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const at = new Map(cases.map((id, position) => [id, position]));
  const module: SetExecutionModule = {
    file,
    // `lines.map(...)` callbacks of one function: one name, one path, told apart by occurrence.
    blocks: regions.map(([line, , name = 'warningBlocks/map.arg0']) => ({
      kind: 'function', name, path: 'entry', startLine: line, endLine: line, source: true,
    })),
    called: Uint32Array.from(regions, ([, callers]) => sets.intern(callers.map((id) => at.get(id)!))),
    loaded: new Uint8Array(regions.length),
  };
  return encodeSetExecutionIndex({ tests, modules: [module], sets: sets.pool() });
}

describe('a module the index holds at an older text than the snapshot', () => {
  const one = 'blocks.test.ts > warns';
  // The index cut `blocks.ts` before a line was written above the function;
  // the snapshot re-cut its rows to the text after, and the run recorded that
  // same text, so every region stands one line lower than the index says.
  const held = cutAt([one], 'src/blocks.ts', [[414, []], [415, [one]], [416, []]]);
  const fresh = cutAt([one], 'src/blocks.ts', [[415, []], [416, [one]], [417, []]]);
  const same = { ...ran(['blocks.test.ts']), sameText: () => true };

  it('cuts the before layer at the lines the run recorded, so a line written above the region moves no case', () => {
    const { merged, before, unlined } = layerCaseIndex(held, fresh, same);

    const moved = caseMotion(decodeExecutionIndex(before!), decodeExecutionIndex(merged), { diff: new Map() });
    expect(moved.regions).toEqual([]);
    expect(unlined).toBeUndefined();
  });

  it('keeps the lines the index was cut at when nobody says the run recorded the text the snapshot names', () => {
    expect(linesOf(layerCaseIndex(held, fresh, ran(['blocks.test.ts'])).before)).toEqual([414, 415, 416]);
  });

  it('asks of the landing\'s base, not the index laid over, whether its cut is the text the run recorded', () => {
    const files = { ...same, base: held };

    expect(linesOf(layerCaseIndex(fresh, fresh, files).before)).toEqual([414, 415, 416]);
    expect(linesOf(layerCaseIndex(fresh, fresh, { ...files, sameBeforeText: () => false }).before)).toEqual([414, 415, 416]);
    expect(linesOf(layerCaseIndex(fresh, fresh, { ...files, sameBeforeText: () => true }).before)).toEqual([415, 416, 417]);
  });

  it('leaves out a region the recorded cut has no address for, since no line of the newer text holds it', () => {
    const gone = cutAt([one], 'src/blocks.ts', [[414, []], [415, [one]], [416, []], [418, [one], 'warningBlocks/removed']]);

    expect(linesOf(layerCaseIndex(gone, fresh, same).before)).toEqual([415, 416, 417]);
  });

  it('names a module whose two texts seat their regions apart as unlined, and leaves its lines as they were cut', () => {
    // A callback written in front of the others renumbers every seat behind it.
    const seated = cutAt([one], 'src/blocks.ts', [[414, [], 'anon#0'], [415, [one], 'anon#1']]);
    const reseated = cutAt([one], 'src/blocks.ts', [[415, [], 'anon#0'], [416, [], 'anon#1'], [417, [one], 'anon#2']]);

    const { before, unlined } = layerCaseIndex(seated, reseated, same);

    expect(unlined).toEqual(['src/blocks.ts']);
    expect(linesOf(before)).toEqual([414, 415]);
  });

  it('lands a case of a file the run did not run only where the numbering agrees, when the index stands at a text numbered apart', () => {
    const other = 'other.test.ts > keeps';
    // `other` entered the second callback, which a callback written in front made `anon#2`.
    const seated = cutAt([one, other], 'src/blocks.ts', [[414, [], 'anon#0'], [415, [other], 'anon#1']]);
    const reseated = cutAt([one], 'src/blocks.ts', [[415, [], 'anon#0'], [416, [], 'anon#1'], [417, [one], 'anon#2']]);

    const { merged } = layerCaseIndex(seated, reseated, same);

    const regions = decodeExecutionIndex(merged).modules[0]!.blocks;
    const tests = decodeExecutionIndex(merged).tests;
    const entered = regions.filter((block) => block.crossings.some((crossing) => tests[crossing.test]!.id === other));
    expect(entered.map((block) => block.name)).not.toContain('anon#1');
  });

  it('lands a held callback on the one at its lines when its cut lacks a sibling written before it', () => {
    const other = 'other.test.ts > keeps';
    const [filter, map] = ['changelogOf/filter.arg0', 'changelogOf/map.arg0'];
    // The index's cut kept only the second `map` callback, so its address is the first.
    const lacking = cutAt([one, other], 'src/changelog.ts', [[273, [one, other], filter], [283, [one, other], map]]);
    const whole = cutAt([one], 'src/changelog.ts', [[273, [one], filter], [276, [], map], [283, [one], map]]);

    const { merged, before, unlined } = layerCaseIndex(lacking, whole, same);

    const change = coverageChange(decodeExecutionIndex(lacking), decodeExecutionIndex(merged), { diff: new Map() });
    expect(change.lost).toBe(0);
    expect(change.testFiles).toEqual([]);
    expect(linesOf(before)).toEqual([273, 283]);
    expect(unlined).toBeUndefined();
  });

  it('names a module unlined when a held callback finds no sibling at its lines in a cut that lacks one', () => {
    const other = 'other.test.ts > keeps';
    const map = 'changelogOf/map.arg0';
    // The run's cut lacks the first callback: lacking, or the text moved under a name that says it did not.
    const whole = cutAt([one, other], 'src/changelog.ts', [[276, [other], map], [283, [one], map]]);
    const lacking = cutAt([one], 'src/changelog.ts', [[283, [one], map]]);

    const { merged, unlined } = layerCaseIndex(whole, lacking, same);

    expect(unlined).toEqual(['src/changelog.ts']);
    expect(decodeExecutionIndex(merged).modules[0]!.blocks.map((block) => block.crossings.length)).toEqual([1]);
  });

  it('names nothing unlined when the index already stands at the lines the run recorded', () => {
    const extra = cutAt([one], 'src/blocks.ts', [[415, []], [416, [one]], [417, []], [418, [one], 'warningBlocks/build-only']]);

    const { before, unlined } = layerCaseIndex(extra, fresh, same);

    expect(unlined).toBeUndefined();
    expect(linesOf(before)).toEqual([415, 416, 417, 418]);
  });
});

/** The lines a layer's one module stands its regions on. */
function linesOf(layer: Uint8Array | undefined): number[] {
  return decodeExecutionIndex(layer!).modules[0]!.blocks.map((block) => block.startLine);
}
