import { describe, expect, it } from 'vitest';
import { CaseLinesBuilder, lineValue } from './case-lines.js';
import { inputsOf, layReadings, readingsOf, READINGS } from './case-readings.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex, openSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';

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
/** A run that announced every case its index holds, over the texts `same` names. */
const over = (fresh: Buffer, same: (file: string) => boolean = unchanged, inputs?: ReadonlyMap<string, string>) => ({
  fresh,
  announced: new Set(openSetExecutionIndex(fresh)!.tests.map((test) => test.id)),
  same,
  ...(inputs === undefined ? {} : { inputs }),
});

/** Lay `runs` one after another over the same texts, as each run's record would; `inputs` what each run's test files ran over. */
function laid(runs: readonly Buffer[], same: (file: string) => boolean = unchanged, inputs?: readonly ReadonlyMap<string, string>[]): { section?: Buffer; index: Buffer } {
  let section: Buffer | undefined;
  let index: Buffer | undefined;
  runs.forEach((fresh, at) => {
    section = layReadings(section, index, fresh, cases, over(fresh, same, inputs?.[at]));
    index = fresh;
  });
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

    expect(layReadings(section, run(false, { wire: 2, handle: 4 }), run(true, { handle: 3 }), cases, over(run(true, { handle: 3 }), () => false))).toBeUndefined();
  });

  it('counts a reading it already holds rather than storing it again', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(false, { wire: 2 }), run(false, { wire: 2 })]);

    expect(readingsOf(section, index, ID)!.map(({ count, stopped }) => ({ count, stopped }))).toEqual([
      { count: 2, stopped: false },
      { count: 1, stopped: true },
    ]);
  });

  it('holds a case read alike every run as its count alone', () => {
    expect(laid([run(false, { wire: 2 })]).section).toBeUndefined();
    const { section } = laid([run(false, { wire: 2 }), run(false, { wire: 2 }), run(false, { wire: 2 })]);

    expect(JSON.parse(section!.toString('utf8'))).toEqual({ cases: { [ID]: [{ count: 3, stopped: false }] } });
  });

  it('keeps the count of runs read alike once a run reads otherwise', () => {
    const { section, index } = laid([run(false, { wire: 2 }), run(false, { wire: 2 }), run(true, { handle: 3 })]);

    expect(readingsOf(section, index, ID)!.map(({ count, stopped }) => ({ count, stopped }))).toEqual([
      { count: 1, stopped: true },
      { count: 2, stopped: false },
    ]);
  });

  it('keeps the readings of a case its run carried from the index it was laid over without running it', () => {
    const { section, index } = laid([run(true, { handle: 3 }), run(false, { wire: 2 })]);
    const carried = { ...over(index), announced: new Set<string>() };

    expect(layReadings(section, index, index, cases, carried)?.toString()).toEqual(section!.toString());
  });

  it('keeps only the newest once a file the readings ran over is read at another input, whatever regions it crossed', () => {
    const at = (digest: string) => new Map([['a.test.ts', digest]]);
    const kept = laid([run(true, { handle: 3 }), run(false, { wire: 2 })], unchanged, [at('one'), at('one')]);
    expect(readingsOf(kept.section, kept.index, ID)!.map(({ stopped }) => stopped)).toEqual([false, true]);

    const moved = laid([run(true, { handle: 3 }), run(false, { wire: 2 })], unchanged, [at('one'), at('two')]);
    expect(readingsOf(moved.section, moved.index, ID)).toBeUndefined();
    expect(JSON.parse(moved.section!.toString('utf8'))).toEqual({ inputs: { 'a.test.ts': 'two' } });
  });

  it('keeps a case its readings where the index it is laid over holds fewer cases', () => {
    const { section } = laid([run(true, { handle: 3 }, ['b.test.ts > other']), run(false, { wire: 2 }, ['b.test.ts > other'])]);
    const cut = run(false, { wire: 2 });

    expect(readingsOf(layReadings(section, cut, cut, cases), cut, ID)!.map(({ stopped }) => stopped)).toEqual([false, true]);
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

  it('refuses a section that is not the readings it writes', () => {
    const index = run(false, { wire: 2 });

    expect(() => readingsOf(Buffer.from('{"cases":'), index, ID)).toThrow(/readings section/);
    expect(() => readingsOf(Buffer.from('[]'), index, ID)).toThrow(/readings section/);
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

    expect(layReadings(section, index, landed, new Set([ID, 'b.test.ts > other']), over(other, (file) => file !== 'src/page.ts'))).toBeUndefined();
    expect(layReadings(section, index, landed, new Set([ID, 'b.test.ts > other']), over(other))?.toString()).toEqual(section?.toString());
  });

  it('keeps the newest reading as it ran where the landed index holds the case laid over the one before', () => {
    const passed = run(false, { wire: 2, handle: 4 });
    const { section: once } = laid([passed]);
    // A case recorded once, as the index holds it, costs the section nothing.
    expect(once).toBeUndefined();
    const threw = run(true, { handle: 3 });
    const union = run(true, { wire: 2, handle: 3 });
    const section = layReadings(once, passed, union, cases, over(threw));

    expect(readingsOf(section, union, ID)).toEqual([
      { count: 1, stopped: true, regions: [['src/page.ts', 'handle', 'handle', 2, 2, lineValue(3, false)]] },
      { count: 1, stopped: false, regions: [['src/page.ts', 'wire', 'wire', 1, 1, lineValue(2, false)], ['src/page.ts', 'handle', 'handle', 2, 2, lineValue(4, false)]] },
    ]);
    const next = layReadings(section, union, passed, cases, over(passed));
    expect(readingsOf(next, passed, ID)!.map(({ count, stopped }) => ({ count, stopped }))).toEqual([
      { count: 2, stopped: false },
      { count: 1, stopped: true },
    ]);
  });

  it('stores the newest reading of a case run once where the landed index holds it otherwise', () => {
    const threw = run(true, { handle: 3 });
    const section = layReadings(undefined, undefined, run(true, { wire: 2, handle: 3 }), cases, over(threw));

    expect(readingsOf(section, run(true, { wire: 2, handle: 3 }), ID)).toEqual([
      { count: 1, stopped: true, regions: [['src/page.ts', 'handle', 'handle', 2, 2, lineValue(3, false)]] },
    ]);
  });
});

describe('inputsOf', () => {
  /** `a.test.ts` entered `src/page.ts` and only loaded `src/config.ts`; `b.test.ts` reached neither. */
  const coverage = (texts: { readonly page: string; readonly config: string }, setup = 'one') => inputsOf({
    tests: [
      { file: 'a.test.ts', preconditions: [{ name: 'vitest.setup.ts', digest: setup }] },
      { file: 'b.test.ts', preconditions: [] },
    ],
    modules: [
      { file: 'src/page.ts', sourceDigest: texts.page, instrumented: true, blocks: [{ testFiles: ['a.test.ts'] }] },
      { file: 'src/config.ts', sourceDigest: texts.config, instrumented: true, blocks: [{ testFiles: [], loadedBy: ['a.test.ts'] }] },
    ] as never,
  });
  const base = coverage({ page: '1', config: '1' });

  it('names each test file by the texts it entered and loaded, and its preconditions', () => {
    expect(coverage({ page: '2', config: '1' }).get('a.test.ts')).not.toBe(base.get('a.test.ts'));
    expect(coverage({ page: '1', config: '2' }).get('a.test.ts')).not.toBe(base.get('a.test.ts'));
    expect(coverage({ page: '1', config: '1' }, 'two').get('a.test.ts')).not.toBe(base.get('a.test.ts'));
  });

  it('leaves a test file as it was when only a module it never reached moved', () => {
    expect(coverage({ page: '2', config: '2' }).get('b.test.ts')).toBe(base.get('b.test.ts'));
  });
});
