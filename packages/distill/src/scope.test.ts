import type { ExecutionIndex, TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { distillScope, formatScopeDistillation, scopeRows, type ScopeRecord } from './index.js';

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
  options: { readonly suite?: string; readonly incomplete?: readonly string[] } = {},
): ScopeRecord {
  const files = [...new Set(Object.values(modules).flatMap((module) => module.by))].sort();
  const coverage: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: files.map((file) => ({ file, complete: !options.incomplete?.includes(file), preconditions: [] })),
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
  return { ...(options.suite === undefined ? {} : { suite: options.suite }), coverage, execution };
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
const imports = (file: string) => EDGES[file] ?? [];
const republishes = (file: string) => file === 'packages/ui/src/index.ts';

describe('distillScope', () => {
  it('ranks an import by the lines it loads for nothing in every test file it reaches', () => {
    const result = distillScope({ records: [record(MODULES)], imports, republishes });

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
    const result = distillScope({ within: 'packages/app/', records: [record(MODULES)], imports, republishes });

    expect(result.files).toBe(2);
    expect(result.spills.map(({ files, lines }) => [files, lines])).toEqual([[[A, B], 200], [[A], 40]]);
  });

  it('refuses a directory that holds no recorded test file', () => {
    expect(() => distillScope({ within: 'packages/none', records: [record(MODULES)], imports, republishes }))
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
      imports,
      republishes,
    });

    expect(result.suites).toEqual(['unit', 'e2e']);
    expect(result.spills[0]).toMatchObject({ files: [A, B, C], lines: 300 });
  });

  it('withholds a test file whose reading is withheld, and says why', () => {
    const result = distillScope({ records: [record(MODULES, { incomplete: [B] })], imports, republishes });

    expect(result.read).toBe(2);
    expect(result.withheld).toEqual([{ file: B, reason: expect.stringContaining('incomplete') }]);
    expect(result.spills[0]).toMatchObject({ files: [A, C], lines: 200 });
  });

  it('names each module as its own spill when no imports are given', () => {
    const result = distillScope({ records: [record(MODULES)] });

    expect(result.spills).toEqual([
      { modules: ['packages/ui/src/chart.ts'], files: [A, B, C], lines: 300 },
      { modules: ['packages/app/src/heavy.ts'], files: [A], lines: 40 },
    ]);
  });

  it('heads the text with the scope and puts the heaviest import first', () => {
    const text = formatScopeDistillation(distillScope({ within: 'packages/app', records: [record(MODULES)], imports, republishes }));

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
      imports,
      republishes,
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
      imports,
      lazy: (file) => (file === 'packages/app/src/a.ts' ? ['packages/app/src/lazy.ts'] : []),
      republishes,
    });

    expect(result.spills.find((spill) => spill.modules.includes('packages/app/src/lazy.ts'))).toEqual({
      cause: { kind: 'import', importer: 'packages/app/src/a.ts', imported: 'packages/app/src/lazy.ts', lazy: true },
      modules: ['packages/app/src/lazy.ts'],
      files: [A],
      lines: 7,
    });
  });

  it('heads each spill with its module when no imports are given', () => {
    const text = formatScopeDistillation(distillScope({ records: [record(MODULES)] }));

    expect(text.split('\n')[3]).toBe('  packages/ui/src/chart.ts: 1 module(s) in 3 test file(s), 300 line(s)');
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

  it('says why a row is withheld instead of counting what no case entered', () => {
    const rows = [...scopeRows({ within: 'packages/app', records: [record(MODULES, { incomplete: [B] })] })];

    expect(rows[1]).toEqual({ file: B, cases: 1, loaded: { modules: 3, lines: 120 }, withheld: expect.stringContaining('incomplete') });
  });

  it('refuses a directory that holds no recorded test file', () => {
    expect(() => [...scopeRows({ within: 'packages/none', records: [record(MODULES)] })])
      .toThrow('The record holds no test file under `packages/none`.');
  });
});

/** `list` as it is, counting into `reads` each element read from it. */
function counted<T>(list: readonly T[], reads: { count: number }): readonly T[] {
  return new Proxy(list, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.count += 1;
      return Reflect.get(target, key, receiver);
    },
  });
}

// Forty test files that load the same modules: read file by file, a shared list is read for each of them.
const MANY = Array.from({ length: 40 }, (_, at) => `packages/app/test/${String(at).padStart(2, '0')}.test.ts`);
const subjectOf = (file: string) => file.replace('/test/', '/src/').replace('.test.ts', '.ts');

describe('reading a scope of many test files', () => {
  it("reads each shared module's loaders once, however many test files follow an import to it", () => {
    const shared = record({
      'packages/ui/src/button.ts': { by: MANY, enteredBy: MANY },
      'packages/ui/src/chart.ts': { by: MANY, lines: 100 },
      ...Object.fromEntries(MANY.map((file) => [subjectOf(file), { by: [file], enteredBy: [file] }])),
    });
    const reads = { count: 0 };
    const coverage: TestCoverage = {
      ...shared.coverage,
      modules: shared.coverage.modules.map((module) => ({
        ...module,
        blocks: module.blocks.map((block) =>
          block.loadedBy === undefined ? block : { ...block, loadedBy: counted(block.loadedBy, reads) }),
      })),
    };
    const edges = (file: string) =>
      MANY.includes(file) ? [subjectOf(file)] : file.startsWith('packages/app/src/') ? ['packages/ui/src/button.ts', 'packages/ui/src/chart.ts'] : [];

    const scope = distillScope({ records: [{ ...shared, coverage }], imports: edges });

    expect(scope.spills).toHaveLength(MANY.length);
    expect(scope.spills[0]!.cause).toEqual({ kind: 'import', importer: subjectOf(MANY[0]!), imported: 'packages/ui/src/chart.ts' });
    // Every loader once: the two shared modules' forty each, and each subject's own.
    expect(reads.count).toBe(MANY.length * 3);
  });
});
