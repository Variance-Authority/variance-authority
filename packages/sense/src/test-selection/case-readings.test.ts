import { describe, expect, it } from 'vitest';
import { CaseLinesBuilder, lineValue } from './case-lines.js';
import { layReadings, readingsOf, READINGS } from './case-readings.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';

const ID = 'a.test.ts > clicks';

/** One case over `src/page.ts`'s regions `wire` and `handle`, each crossed at the spec line given, or not crossed. */
function run(stopped: boolean, lines: { readonly wire?: number; readonly handle?: number }): Buffer {
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
    tests: [{ id: ID, file: 'a.test.ts', name: 'clicks', stopped }],
    modules: [module],
    sets: sets.pool(),
    lines: [builder.finish()],
  });
}

const cases = new Set([ID]);
const unchanged = () => true;

/** Lay `runs` one after another over the same texts, as each run's record would. */
function laid(runs: readonly Buffer[], same: (file: string) => boolean = unchanged): { section?: Buffer; index: Buffer } {
  let section: Buffer | undefined;
  let index: Buffer | undefined;
  for (const fresh of runs) {
    section = layReadings(section, index, fresh, cases, same);
    index = fresh;
  }
  return { ...(section === undefined ? {} : { section }), index: index! };
}

describe('layReadings', () => {
  it('keeps the reading a rerun over the same texts replaces, beside the new one', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(false, { wire: 2, handle: 4 })]);

    expect(readingsOf(section, index, ID)).toEqual([
      { count: 1, stopped: false, regions: [['src/page.ts', 'wire', 1, 1, lineValue(2, false)], ['src/page.ts', 'handle', 2, 2, lineValue(4, false)]] },
      { count: 1, stopped: true, regions: [['src/page.ts', 'handle', 2, 2, lineValue(3, false)]] },
    ]);
  });

  it('keeps only the newest once a module either reading entered was recorded from another text', () => {
    const { section } = laid([run(true, { handle: 3 }), run(false, { wire: 2, handle: 4 })]);

    expect(layReadings(section, run(false, { wire: 2, handle: 4 }), run(true, { handle: 3 }), cases, () => false)).toBeUndefined();
  });

  it('counts a reading it already holds rather than storing it again', () => {
    const { section, index } = laid([run(false, { wire: 2 }), run(false, { wire: 2 }), run(false, { wire: 2 })]);

    expect(readingsOf(section, index, ID)).toEqual([
      { count: 3, stopped: false, regions: [['src/page.ts', 'wire', 1, 1, lineValue(2, false)]] },
    ]);
    expect(JSON.parse(section!.toString('utf8'))).toEqual({ [ID]: { modules: ['src/page.ts'], readings: [{ count: 3, stopped: false }] } });
  });

  it('drops the oldest distinct reading past the bound', () => {
    const runs = Array.from({ length: READINGS + 1 }, (_, at) => run(at % 2 === 0, { wire: at + 1 }));
    const { section, index } = laid(runs);

    const readings = readingsOf(section, index, ID)!;
    expect(readings).toHaveLength(READINGS);
    expect(readings.at(-1)!.regions).toEqual([['src/page.ts', 'wire', 1, 1, lineValue(2, false)]]);
  });

  it('drops the readings of a case the run did not record once it records a module they entered from another text', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(false, { handle: 4 })]);
    const other = encodeSetExecutionIndex({
      tests: [{ id: 'b.test.ts > other', file: 'b.test.ts', name: 'other' }],
      modules: [{ file: 'src/page.ts', blocks: [], called: new Uint32Array(), loaded: new Uint8Array() }],
      sets: new CrossingSets(1).pool(),
    });

    expect(layReadings(section, index, other, new Set([ID, 'b.test.ts > other']), (file) => file !== 'src/page.ts')).toBeUndefined();
    expect(layReadings(section, index, other, new Set([ID, 'b.test.ts > other']), unchanged)).toEqual(section);
  });
});
