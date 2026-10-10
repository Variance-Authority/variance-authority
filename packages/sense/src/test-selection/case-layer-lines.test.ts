import { describe, expect, it } from 'vitest';
import { layerCaseIndex, type CaseRunFiles } from './case-layer.js';
import { CaseLinesBuilder, lineAt, linesOf, lineValue } from './case-lines.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeSetExecutionIndex, openSetColumns, type SetExecutionModule } from './execution-set-format.js';
import { repinnedCases } from './milestone-repin.js';

/** A region's name and, per case that crossed it, the test line that reached it: a positive line its own, a negative one a hook's. */
type Region = readonly [name: string, reached: Readonly<Record<string, number>>];

/** A case index as a fold writes one, with lines where `lined` holds and none where it does not. */
function index(cases: readonly string[], modules: Record<string, readonly Region[]>, lined = true): Buffer {
  const tests = cases.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const at = new Map(cases.map((id, position) => [id, position]));
  const builders = cases.map(() => new CaseLinesBuilder());
  const spelled: SetExecutionModule[] = Object.entries(modules).map(([file, regions], module) => {
    for (const [block, [, reached]] of regions.entries()) {
      for (const [id, line] of Object.entries(reached)) builders[at.get(id)!]!.add(module, block, lineValue(Math.abs(line), line < 0));
    }
    return {
      file,
      blocks: regions.map(([name], line) => ({ kind: 'function', name, path: name, startLine: line + 1, endLine: line + 1, source: true })),
      called: Uint32Array.from(regions, ([, reached]) => sets.intern(Object.keys(reached).map((id) => at.get(id)!).sort((l, r) => l - r))),
      loaded: new Uint8Array(regions.length),
    };
  });
  return encodeSetExecutionIndex({
    tests, modules: spelled, sets: sets.pool(), ...(lined ? { lines: builders.map((builder) => builder.finish()) } : {}),
  });
}

/** Each case's lines back, by file and region name, as a line, negative for a hook's; `null` for a case whose lines were not recorded. */
function lines(bytes: Uint8Array): Record<string, Record<string, number> | null> {
  const decoded = decodeExecutionIndex(bytes);
  const table = openSetColumns(bytes)!.testLines;
  const out: Record<string, Record<string, number> | null> = {};
  for (const [test, { id }] of decoded.tests.entries()) {
    const held = linesOf(table, test);
    if (held === undefined) {
      out[id] = null;
      continue;
    }
    const reached: Record<string, number> = {};
    for (const [module, { file, blocks }] of decoded.modules.entries()) {
      for (const [block, { name, crossings }] of blocks.entries()) {
        if (!crossings.some((crossing) => crossing.test === test)) continue;
        const { line, ambient } = lineAt(held, module, block)!;
        reached[`${file}#${name}`] = ambient ? -line : line;
      }
    }
    out[id] = reached;
  }
  return out;
}

function ran(files: readonly string[], finished: readonly string[] = files): CaseRunFiles {
  return { ran: new Set(files), finished: new Set(finished), present: () => true };
}

const suite = index(
  ['a.test.ts > one', 'b.test.ts > three'],
  {
    'src/shared.ts': [['entry', { 'a.test.ts > one': -2, 'b.test.ts > three': 8 }], ['rare', { 'a.test.ts > one': 4 }]],
    'src/b-only.ts': [['only', { 'b.test.ts > three': -6 }]],
  },
);

describe('a layered case index carries the line that reached each region', () => {
  it('takes a finished file\'s lines from the run and keeps every other case\'s where it was', () => {
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', {}], ['rare', { 'a.test.ts > one': 5 }]] });

    expect(lines(layerCaseIndex(suite, fresh, ran(['a.test.ts'])).merged)).toEqual({
      'a.test.ts > one': { 'src/shared.ts#rare': 5 },
      'b.test.ts > three': { 'src/b-only.ts#only': -6, 'src/shared.ts#entry': 8 },
    });
  });

  it('joins a case that ran again in an unfinished file, the run\'s line winning where both reached a region', () => {
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', {}], ['rare', { 'a.test.ts > one': 9 }]] });

    expect(lines(layerCaseIndex(suite, fresh, ran(['a.test.ts'], [])).merged)).toEqual({
      'a.test.ts > one': { 'src/shared.ts#entry': -2, 'src/shared.ts#rare': 9 },
      'b.test.ts > three': { 'src/b-only.ts#only': -6, 'src/shared.ts#entry': 8 },
    });
  });

  it('reads a case an old record carried as one whose lines were not recorded', () => {
    const old = index(['a.test.ts > one', 'b.test.ts > three'], {
      'src/shared.ts': [['entry', { 'b.test.ts > three': 1 }], ['rare', { 'a.test.ts > one': 1 }]],
    }, false);
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', { 'a.test.ts > one': 3 }], ['rare', {}]] });

    expect(lines(layerCaseIndex(old, fresh, ran(['a.test.ts'])).merged)).toEqual({
      'a.test.ts > one': { 'src/shared.ts#entry': 3 },
      'b.test.ts > three': null,
    });
  });

  it('records no lines for a case one of its sources did not', () => {
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', {}], ['rare', { 'a.test.ts > one': 1 }]] }, false);

    expect(lines(layerCaseIndex(suite, fresh, ran(['a.test.ts'], [])).merged)).toEqual({
      'a.test.ts > one': null,
      'b.test.ts > three': { 'src/b-only.ts#only': -6, 'src/shared.ts#entry': 8 },
    });
  });

  it('writes no lines where neither index recorded any', () => {
    const old = index(['b.test.ts > three'], { 'src/shared.ts': [['entry', { 'b.test.ts > three': 1 }]] }, false);
    const fresh = index(['a.test.ts > one'], { 'src/shared.ts': [['entry', { 'a.test.ts > one': 1 }]] }, false);

    expect(openSetColumns(layerCaseIndex(old, fresh, ran(['a.test.ts'])).merged)!.testLines).toBeUndefined();
  });

  it('keeps the lines of the checkout\'s cases when a repin lays them over a newer milestone', () => {
    const milestone = index(['b.test.ts > three'], { 'src/b-only.ts': [['only', { 'b.test.ts > three': -6 }]] });
    const own = index(['b.test.ts > three', 'a.test.ts > one'], {
      'src/b-only.ts': [['only', { 'b.test.ts > three': 2 }]],
      'src/shared.ts': [['entry', {}], ['rare', { 'a.test.ts > one': 4 }]],
    });

    expect(lines(repinnedCases(milestone, own, new Set(['a.test.ts']))!)).toEqual({
      'a.test.ts > one': { 'src/shared.ts#rare': 4 },
      'b.test.ts > three': { 'src/b-only.ts#only': -6 },
    });
  });
});
