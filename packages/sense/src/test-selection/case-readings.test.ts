import { describe, expect, it } from 'vitest';
import { CaseLinesBuilder, lineValue } from './case-lines.js';
import { layReadings, readingsOf, READINGS } from './case-readings.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';

const ID = 'a.test.ts > clicks';

/** One case over `src/page.ts`'s regions `wire` and `handle`, each crossed at the spec line given, or not crossed, beside the cases `also` names, which cross nothing. */
function run(stopped: boolean, lines: { readonly wire?: number; readonly handle?: number }, also: readonly string[] = []): Buffer {
  const sets = new CrossingSets(1);
  sets.intern([]);
  const regions = (['wire', 'handle'] as const);
  const builder = new CaseLinesBuilder();
  regions.forEach((name, block) => {
    const line = lines[name];
    if (line !== undefined) builder.add(0, block, lineValue(line, false));
  });
  const module: SetExecutionModule = {
    file: 'src/page.ts',
    blocks: regions.map((name, at) => ({ kind: 'function', name, path: name, startLine: at + 1, endLine: at + 1, source: true })),
    called: Uint32Array.from(regions, (name) => sets.intern(lines[name] === undefined ? [] : [0])),
    loaded: new Uint8Array(regions.length),
  };
  return encodeSetExecutionIndex({
    tests: [{ id: ID, file: 'a.test.ts', name: 'clicks', stopped }, ...also.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }))],
    modules: [module],
    sets: sets.pool(),
    lines: [builder.finish(), ...also.map(() => new CaseLinesBuilder().finish())],
  });
}

const cases = new Set([ID]);
const unchanged = () => true;

/** Lay `runs` one after another over the same texts, as each run's record would. */
function laid(runs: readonly Buffer[], same: (file: string) => boolean = unchanged): { section?: Buffer; index: Buffer } {
  let section: Buffer | undefined;
  let index: Buffer | undefined;
  for (const fresh of runs) {
    section = layReadings(section, index, fresh, fresh, cases, same);
    index = fresh;
  }
  return { ...(section === undefined ? {} : { section }), index: index! };
}

describe('layReadings', () => {
  it('keeps the reading a rerun over the same texts replaces, beside the new one', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(false, { wire: 2, handle: 4 })]);

    expect(readingsOf(section, index, ID)).toEqual([
      { count: 1, stopped: false, regions: [['src/page.ts', 'wire', 'wire', 1, 1, lineValue(2, false)], ['src/page.ts', 'handle', 'handle', 2, 2, lineValue(4, false)]] },
      { count: 1, stopped: true, regions: [['src/page.ts', 'handle', 'handle', 2, 2, lineValue(3, false)]] },
    ]);
  });

  it('keeps only the newest once a module either reading entered was recorded from another text', () => {
    const { section } = laid([run(true, { handle: 3 }), run(false, { wire: 2, handle: 4 })]);

    expect(layReadings(section, run(false, { wire: 2, handle: 4 }), run(true, { handle: 3 }), run(true, { handle: 3 }), cases, () => false)).toBeUndefined();
  });

  it('counts a reading it already holds rather than storing it again', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(false, { wire: 2 }), run(false, { wire: 2 })]);

    expect(readingsOf(section, index, ID)!.map(({ count, stopped }) => ({ count, stopped }))).toEqual([
      { count: 2, stopped: false },
      { count: 1, stopped: true },
    ]);
  });

  it('holds nothing of a case read alike every run', () => {
    expect(laid([run(false, { wire: 2 }), run(false, { wire: 2 }), run(false, { wire: 2 })]).section).toBeUndefined();
  });

  it('keeps a case its readings where the index it is laid over holds fewer cases', () => {
    const { section } = laid([run(true, { handle: 3 }, ['b.test.ts > other']), run(false, { wire: 2 }, ['b.test.ts > other'])]);
    const cut = run(false, { wire: 2 });

    expect(readingsOf(layReadings(section, cut, undefined, cut, cases, unchanged), cut, ID)!.map(({ stopped }) => stopped)).toEqual([false, true]);
  });

  it('stores an earlier reading as what it read otherwise than the newest', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(true, { wire: 1, handle: 3 }), run(false, { wire: 2, handle: 4 })]);

    expect(JSON.parse(section!.toString('utf8'))).toEqual({
      cases: { [ID]: [{ count: 1, stopped: false }, { count: 1, stopped: true, values: [[0, lineValue(1, false)], [1, lineValue(3, false)]] }, { count: 1, stopped: true, gone: [0], values: [[1, lineValue(3, false)]] }] },
    });
    expect(readingsOf(section, index, ID)!.map(({ regions }) => regions.map(([, name, , , , value]) => [name, value]))).toEqual([
      [['wire', lineValue(2, false)], ['handle', lineValue(4, false)]],
      [['wire', lineValue(1, false)], ['handle', lineValue(3, false)]],
      [['handle', lineValue(3, false)]],
    ]);
  });

  it('drops the oldest distinct reading past the bound', () => {
    const runs = Array.from({ length: READINGS + 1 }, (_, at) => run(at % 2 === 0, { wire: at + 1 }));
    const { section, index } = laid(runs);

    const readings = readingsOf(section, index, ID)!;
    expect(readings).toHaveLength(READINGS);
    expect(readings.at(-1)!.regions).toEqual([['src/page.ts', 'wire', 'wire', 1, 1, lineValue(2, false)]]);
  });

  it('drops the readings of a case the run did not record once it records a module they entered from another text', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(false, { handle: 4 })]);
    const other = encodeSetExecutionIndex({
      tests: [{ id: 'b.test.ts > other', file: 'b.test.ts', name: 'other' }],
      modules: [{ file: 'src/page.ts', blocks: [], called: new Uint32Array(), loaded: new Uint8Array() }],
      sets: new CrossingSets(1).pool(),
    });

    const landed = run(false, { handle: 4 }, ['b.test.ts > other']);

    expect(layReadings(section, index, other, landed, new Set([ID, 'b.test.ts > other']), (file) => file !== 'src/page.ts')).toBeUndefined();
    expect(layReadings(section, index, other, landed, new Set([ID, 'b.test.ts > other']), unchanged)?.toString()).toEqual(section?.toString());
  });

  it('keeps the newest reading as it ran where the landed index holds the case laid over the one before', () => {
    const passed = run(false, { wire: 2, handle: 4 });
    const { section: once } = laid([passed]);
    // A case recorded once, as the index holds it, costs the section nothing.
    expect(once).toBeUndefined();
    const threw = run(true, { handle: 3 });
    const union = run(true, { wire: 2, handle: 3 });
    const section = layReadings(once, passed, threw, union, cases, unchanged);

    expect(readingsOf(section, union, ID)).toEqual([
      { count: 1, stopped: true, regions: [['src/page.ts', 'handle', 'handle', 2, 2, lineValue(3, false)]] },
      { count: 1, stopped: false, regions: [['src/page.ts', 'wire', 'wire', 1, 1, lineValue(2, false)], ['src/page.ts', 'handle', 'handle', 2, 2, lineValue(4, false)]] },
    ]);
    const next = layReadings(section, union, passed, passed, cases, unchanged);
    expect(readingsOf(next, passed, ID)!.map(({ count, stopped }) => ({ count, stopped }))).toEqual([
      { count: 2, stopped: false },
      { count: 1, stopped: true },
    ]);
  });

  it('stores the newest reading of a case run once where the landed index holds it otherwise', () => {
    const threw = run(true, { handle: 3 });
    const section = layReadings(undefined, undefined, threw, run(true, { wire: 2, handle: 3 }), cases, unchanged);

    expect(readingsOf(section, run(true, { wire: 2, handle: 3 }), ID)).toEqual([
      { count: 1, stopped: true, regions: [['src/page.ts', 'handle', 'handle', 2, 2, lineValue(3, false)]] },
    ]);
  });
});
