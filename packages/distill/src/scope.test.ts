import type { ExecutionIndex, TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { distillScope, formatScopeDistillation, scopeRows, type ScopeRecord } from './index.js';
import { graphOf, recordOf } from './record.fixture.js';

type Block = TestCoverage['modules'][number]['blocks'][number];

/** One module: which test files evaluated it, its length, and which of those files' cases entered it. */
interface Module {
  readonly by: readonly string[];
  readonly lines?: number;
  readonly enteredBy?: readonly string[];
  readonly barrel?: boolean;
}

/** A record of test files with one finished case each, from its modules. */
function record(
  modules: Readonly<Record<string, Module>>,
  options: {
    readonly suite?: string;
    readonly incomplete?: readonly string[];
    readonly times?: Readonly<Record<string, Pick<TestCoverage['tests'][number], 'duration' | 'phases'>>>;
  } = {},
): ScopeRecord {
  const files = [...new Set(Object.values(modules).flatMap((module) => module.by))].sort();
  const coverage: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: files.map((file) => ({ file, complete: !options.incomplete?.includes(file), preconditions: [], ...options.times?.[file] })),
    modules: Object.entries(modules).map(([file, module]) => {
      const root: Block = {
        ordinal: 0, kind: 'module', digest: `${file}#root`, name: '', path: '', source: true,
        testFiles: module.by, loadedBy: module.by, startLine: 1, endLine: module.lines ?? 10,
      };
      const run: Block = {
        ordinal: 1, kind: 'function', owner: 0, digest: `${file}#run`, name: 'run', path: 'run',
        source: true, testFiles: module.by, startLine: 2, endLine: 2,
      };
      return { file, sourceDigest: file, instrumented: true, blocks: module.barrel === true ? [root] : [root, run] };
    }),
  };
  const execution: ExecutionIndex = {
    tests: files.map((file) => ({ id: `${file} > one`, file, name: 'one', stopped: false })),
    modules: Object.entries(modules).map(([file, module]) => ({
      file,
      blocks: [{
        kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true,
        crossings: (module.enteredBy ?? []).map((test) => ({ test: files.indexOf(test), distance: 0 })),
      }],
    })),
  };
  return { ...(options.suite === undefined ? {} : { suite: options.suite }), record: recordOf(coverage, execution) };
}

const A = 'packages/app/test/a.test.ts';
const B = 'packages/app/test/b.test.ts';
const C = 'packages/lib/test/c.test.ts';

// Each test file imports its own subject; the subjects import one barrel, whose button every case uses and whose
// chart no case enters.
const MODULES = {
  'packages/ui/src/index.ts': { by: [A, B, C], barrel: true },
  'packages/ui/src/button.ts': { by: [A, B, C], enteredBy: [A, B, C] },
  'packages/app/src/a.ts': { by: [A], enteredBy: [A] },
  'packages/app/src/b.ts': { by: [B], enteredBy: [B] },
  'packages/lib/src/c.ts': { by: [C], enteredBy: [C] },
  'packages/ui/src/chart.ts': { by: [A, B, C], lines: 100 },
  'packages/app/src/heavy.ts': { by: [A], lines: 40 },
};
const EDGES: Readonly<Record<string, readonly string[]>> = {
  [A]: ['packages/app/src/a.ts'],
  [B]: ['packages/app/src/b.ts'],
  [C]: ['packages/lib/src/c.ts'],
  'packages/app/src/a.ts': ['packages/ui/src/index.ts', 'packages/app/src/heavy.ts'],
  'packages/app/src/b.ts': ['packages/ui/src/index.ts'],
  'packages/lib/src/c.ts': ['packages/ui/src/index.ts'],
  'packages/ui/src/index.ts': ['packages/ui/src/button.ts', 'packages/ui/src/chart.ts'],
};
const BARRELS = ['packages/ui/src/index.ts'];
const relations = graphOf(EDGES, BARRELS);

describe('distillScope', () => {
  it('ranks an import by the lines it loads for nothing in every test file it reaches', () => {
    const result = distillScope({ records: [record(MODULES)], relations });

    expect(result.files).toBe(3);
    expect(result.read).toBe(3);
    expect(result.lines).toBe(340);
    expect(result.spills).toEqual([
      {
        cause: { kind: 'import', importer: 'packages/ui/src/index.ts', imported: 'packages/ui/src/chart.ts' },
        modules: ['packages/ui/src/chart.ts'],
        files: [A, B, C],
        lines: 300,
      },
      {
        cause: { kind: 'import', importer: 'packages/app/src/a.ts', imported: 'packages/app/src/heavy.ts' },
        modules: ['packages/app/src/heavy.ts'],
        files: [A],
        lines: 40,
      },
    ]);
  });

  it('reads only the test files under the directory it is given', () => {
    const result = distillScope({ within: 'packages/app/', records: [record(MODULES)], relations });

    expect(result.files).toBe(2);
    expect(result.spills.map(({ files, lines }) => [files, lines])).toEqual([[[A, B], 200], [[A], 40]]);
  });

  it('refuses a directory that holds no recorded test file', () => {
    expect(() => distillScope({ within: 'packages/none', records: [record(MODULES)], relations }))
      .toThrow('The record holds no test file under `packages/none`.');
  });

  it('reads every record it is given as one scope, and names the suites', () => {
    const ui = (by: readonly string[]) => ({
      'packages/ui/src/index.ts': { by, barrel: true },
      'packages/ui/src/button.ts': { by, enteredBy: by },
      'packages/ui/src/chart.ts': { by, lines: 100 },
    });
    const result = distillScope({
      records: [
        record({ ...ui([A, B]), 'packages/app/src/a.ts': MODULES['packages/app/src/a.ts'], 'packages/app/src/b.ts': MODULES['packages/app/src/b.ts'] }, { suite: 'unit' }),
        record({ ...ui([C]), 'packages/lib/src/c.ts': MODULES['packages/lib/src/c.ts'] }, { suite: 'e2e' }),
      ],
      relations,
    });

    expect(result.suites).toEqual(['unit', 'e2e']);
    expect(result.spills[0]).toMatchObject({ files: [A, B, C], lines: 300 });
  });

  it('answers the same whatever order the record lists its modules in', () => {
    const reversed = Object.fromEntries(Object.entries(MODULES).reverse());

    expect(distillScope({ records: [record(reversed)], relations })).toEqual(distillScope({ records: [record(MODULES)], relations }));
  });

  it('withholds a test file whose reading is withheld, and says why', () => {
    const result = distillScope({ records: [record(MODULES, { incomplete: [B] })], relations });

    expect(result.read).toBe(2);
    expect(result.withheld).toEqual([{ file: B, reason: expect.stringContaining('incomplete') }]);
    expect(result.spills[0]).toMatchObject({ files: [A, C], lines: 200 });
  });

  it('names each module as its own spill when no file graph is given', () => {
    const result = distillScope({ records: [record(MODULES)] });

    expect(result.spills).toEqual([
      { modules: ['packages/ui/src/chart.ts'], files: [A, B, C], lines: 300 },
      { modules: ['packages/app/src/heavy.ts'], files: [A], lines: 40 },
    ]);
  });

  it('heads the text with the scope and puts the heaviest import first', () => {
    const text = formatScopeDistillation(distillScope({ within: 'packages/app', records: [record(MODULES)], relations }));

    expect(text.split('\n').slice(0, 5)).toEqual([
      'packages/app: 2 test file(s), each read.',
      '',
      'Loaded, and entered by no case of the test file that loaded it: 3 module load(s), 240 line(s).',
      '  packages/ui/src/index.ts imports packages/ui/src/chart.ts: 1 module(s) in 2 test file(s), 200 line(s)',
      '  packages/app/src/a.ts imports packages/app/src/heavy.ts: 1 module(s) in 1 test file(s), 40 line(s)',
    ]);
  });

  it('puts what no static import reaches after the imports, and names the withheld files', () => {
    const lazy = { 'packages/app/src/lazy.ts': { by: [A], lines: 7 } };
    const text = formatScopeDistillation(distillScope({
      records: [record({ ...MODULES, ...lazy }, { incomplete: [B] })],
      unrecorded: ['e2e'],
      relations,
    }));

    expect(text.split('\n').slice(0, 10)).toEqual([
      'every test file: 3 test file(s); 2 read, 1 withheld.',
      '',
      'Loaded, and entered by no case of the test file that loaded it: 4 module load(s), 247 line(s).',
      '  packages/ui/src/index.ts imports packages/ui/src/chart.ts: 1 module(s) in 2 test file(s), 200 line(s)',
      '  packages/app/src/a.ts imports packages/app/src/heavy.ts: 1 module(s) in 1 test file(s), 40 line(s)',
      '  No import the graph reads reaches these from the test file: 1 module(s) in 1 test file(s), 7 line(s)',
      '',
      'Not recorded: suite e2e.',
      '',
      `Withheld: ${B}; a test file read alone says why.`,
    ]);
  });

  it('gathers what only a lazy import loads under that import', () => {
    const lazy = { 'packages/app/src/lazy.ts': { by: [A], lines: 7 } };
    const result = distillScope({
      records: [record({ ...MODULES, ...lazy })],
      relations: graphOf(EDGES, BARRELS, { 'packages/app/src/a.ts': ['packages/app/src/lazy.ts'] }),
    });

    expect(result.spills.find((spill) => spill.modules.includes('packages/app/src/lazy.ts'))).toEqual({
      cause: { kind: 'import', importer: 'packages/app/src/a.ts', imported: 'packages/app/src/lazy.ts', lazy: true },
      modules: ['packages/app/src/lazy.ts'],
      files: [A],
      lines: 7,
    });
  });

  it('heads each spill with its module when no file graph is given', () => {
    const text = formatScopeDistillation(distillScope({ records: [record(MODULES)] }));

    expect(text.split('\n')[3]).toBe('  packages/ui/src/chart.ts: 1 module(s) in 3 test file(s), 300 line(s)');
  });
});

// A loads for 60 ms and runs its cases in 4; B loads for 10 and runs for 30; C's runner timed nothing.
const TIMES = {
  [A]: { phases: { prepare: 2, environment: 0, setup: 1, collect: 60, cases: 4 } },
  [B]: { phases: { prepare: 2, environment: 0, setup: 1, collect: 10, cases: 30 } },
};

describe('where the time of a scope went', () => {
  it('sums each phase the runner timed before the cases, and the cases, over the test files that report them', () => {
    expect(distillScope({ records: [record(MODULES, { times: TIMES })], relations }).time).toEqual({
      timed: 2,
      prepare: 4,
      environment: 0,
      setup: 2,
      collect: 70,
      cases: 34,
      loadBound: [{ file: A, loading: 63, cases: 4 }],
    });
  });

  it('counts only the test files under the directory it is given', () => {
    const times = { ...TIMES, [C]: { phases: { prepare: 1, environment: 0, setup: 0, collect: 5, cases: 5 } } };

    expect(distillScope({ within: 'packages/lib', records: [record(MODULES, { times })], relations }).time)
      .toEqual({ timed: 1, prepare: 1, environment: 0, setup: 0, collect: 5, cases: 5, loadBound: [{ file: C, loading: 6, cases: 5 }] });
  });

  it('names a test file load-bound once its loading outlasts its cases, and not at parity', () => {
    const times = {
      [A]: { phases: { collect: 8, cases: 2 } },
      [B]: { phases: { collect: 5, cases: 5 } },
    };

    expect(distillScope({ records: [record(MODULES, { times })], relations }).time?.loadBound)
      .toEqual([{ file: A, loading: 8, cases: 2 }]);
  });

  it('counts as loading everything before the first case, the worker, the environment and the setup files with the import', () => {
    const times = {
      [A]: { phases: { prepare: 125, environment: 979, setup: 15, collect: 4258, cases: 33 } },
      [B]: { phases: { prepare: 10, environment: 40, setup: 5, collect: 20, cases: 30 } },
    };

    expect(distillScope({ records: [record(MODULES, { times })], relations }).time?.loadBound).toEqual([
      { file: A, loading: 5377, cases: 33 },
      { file: B, loading: 75, cases: 30 },
    ]);
  });

  it('names the load-bound files longest loading first, and files that load alike by name', () => {
    const times = {
      [A]: { phases: { collect: 8, cases: 2 } },
      [B]: { phases: { collect: 20, cases: 2 } },
      [C]: { phases: { collect: 8, cases: 1 } },
    };

    expect(distillScope({ records: [record(MODULES, { times })], relations }).time?.loadBound).toEqual([
      { file: B, loading: 20, cases: 2 },
      { file: A, loading: 8, cases: 2 },
      { file: C, loading: 8, cases: 1 },
    ]);
  });

  it('is absent over a record written before phases were recorded', () => {
    const { record: bytes } = record(MODULES, { times: TIMES });
    const length = Buffer.from(bytes).readUInt32LE(0);
    const header = Buffer.from(bytes).toString('utf8', 4, 4 + length);
    const version = (JSON.parse(header.replace(/\0+$/, '')) as { version: number }).version;
    // The layout before phases is the one numbered just below; its readers ignore the section.
    const older = Buffer.from(bytes);
    older.write(header.replace(`"version":${version}`, `"version":${version - 1}`), 4, 'utf8');

    expect(distillScope({ records: [{ record: older }], relations }).time).toBeUndefined();
  });

  it('leaves out a phase no timed test file reported, as Jest reports no prepare', () => {
    const jest = {
      [A]: { phases: { environment: 3, setup: 1, collect: 60, cases: 4 } },
      [B]: { phases: { environment: 2, setup: 1, collect: 10, cases: 30 } },
    };
    const time = distillScope({ records: [record(MODULES, { times: jest })], relations }).time;

    expect(time).toEqual({ timed: 2, environment: 5, setup: 2, collect: 70, cases: 34, loadBound: [{ file: A, loading: 64, cases: 4 }] });
    expect(formatScopeDistillation(distillScope({ records: [record(MODULES, { times: jest })], relations })))
      .not.toContain('prepare');
  });

  it('skips a test file whose runner timed its collect or its cases not at all', () => {
    const times = { [A]: { phases: { collect: 60 } }, [B]: { phases: { cases: 30 } } };

    expect(distillScope({ records: [record(MODULES, { times })], relations }).time).toBeUndefined();
  });

  it('is absent when no test file of the scope reported its phases', () => {
    expect(distillScope({ records: [record(MODULES)], relations }).time).toBeUndefined();
  });

  it('shows each phase in the order the runner meets it, its share, and the files loading dwarfs', () => {
    const text = formatScopeDistillation(distillScope({ records: [record(MODULES, { times: TIMES })], relations }));

    expect(text.split('\n').slice(0, 11)).toEqual([
      'every test file: 3 test file(s), each read.',
      '',
      'Where the time went, as the runner timed 2 of the 3 test file(s): 110 ms.',
      '  prepare, the worker readying the file: 4 ms, 4%',
      '  environment: 0 ms, 0%',
      '  setup files: 2 ms, 2%',
      '  collect, importing the test file and everything it loads: 70 ms, 64%',
      '  cases: 34 ms, 31%',
      'Loading took longer than the cases in 1 test file(s): 63 ms against 4 ms.',
      `  ${A}: 63 ms loading, 4 ms in its cases`,
      '',
    ]);
  });
});

describe('scopeRows', () => {
  it('gives each test file what it loaded and what of that no case of it entered', () => {
    expect([...scopeRows({ records: [record(MODULES, { suite: 'unit' })] })]).toEqual([
      { suite: 'unit', file: A, cases: 1, loaded: { modules: 4, lines: 160 }, unentered: { modules: 2, lines: 140 } },
      { suite: 'unit', file: B, cases: 1, loaded: { modules: 3, lines: 120 }, unentered: { modules: 1, lines: 100 } },
      { suite: 'unit', file: C, cases: 1, loaded: { modules: 3, lines: 120 }, unentered: { modules: 1, lines: 100 } },
    ]);
  });

  it('reports each file\'s recorded phases, preserving zero and omitting unrecorded phases', () => {
    const times = {
      [A]: { phases: { environment: 0, setup: 1, collect: 60, cases: 4 } },
      [B]: { phases: { collect: 0 } },
      [C]: { duration: 7 },
    };
    const rows = [...scopeRows({ records: [record(MODULES, { times })] })];

    expect(rows.map((row) => Object.hasOwn(row, 'time'))).toEqual([true, true, false]);
    expect(rows.map((row) => row.time)).toEqual([
      { environment: 0, setup: 1, collect: 60, cases: 4 },
      { collect: 0 },
      undefined,
    ]);
  });

  it('reports phases even when the unused-module reading is withheld', () => {
    const rows = [...scopeRows({ records: [record(MODULES, { times: TIMES, incomplete: [A] })] })];

    expect(rows[0]).toMatchObject({ withheld: expect.stringContaining('incomplete'), time: TIMES[A].phases });
    expect(rows[0]).not.toHaveProperty('unentered');
  });

  it('joins phases by record and the exact file path, within the requested directory', () => {
    const rows = [...scopeRows({ within: 'packages/app', records: [
      record(MODULES, { suite: 'unit', times: { [A]: { phases: { collect: 2, cases: 0 } } } }),
      record(MODULES, { suite: 'e2e', times: { [A]: { phases: { collect: 9, cases: 1 } } } }),
    ] })];

    expect(rows.map((row) => [row.suite, row.file, row.time])).toEqual([
      ['unit', A, { collect: 2, cases: 0 }], ['unit', B, undefined],
      ['e2e', A, { collect: 9, cases: 1 }], ['e2e', B, undefined],
    ]);
  });

  it('says why a row is withheld instead of counting what no case entered', () => {
    const rows = [...scopeRows({ within: 'packages/app', records: [record(MODULES, { incomplete: [B] })] })];

    expect(rows[1]).toEqual({ file: B, cases: 1, loaded: { modules: 3, lines: 120 }, withheld: expect.stringContaining('incomplete') });
  });

  it('refuses a directory that holds no recorded test file', () => {
    expect(() => [...scopeRows({ within: 'packages/none', records: [record(MODULES)] })])
      .toThrow('The record holds no test file under `packages/none`.');
  });
});
