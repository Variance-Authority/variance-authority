import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordOfCases, withCaseSections } from './case-record.js';
import { encodeExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { decodeTestCoverage, encodeTestCoverage, type CoverageModule, type TestCoverage } from './format.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { readDistillRecords } from './distill-native.js';
import type { ExecutionIndex } from './reverse.js';

const FILE = 'test/a.test.ts';

const COVERAGE: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: [{ file: FILE, complete: true, preconditions: [] }],
  modules: ['src/used.ts', 'src/unused.ts'].map((file) => ({
    file, sourceDigest: file, instrumented: true,
    blocks: [
      { ordinal: 0, kind: 'module', digest: `${file}#root`, name: '', path: '', source: true, testFiles: [FILE], loadedBy: [FILE], startLine: 1, endLine: 10 },
      { ordinal: 1, kind: 'function', owner: 0, digest: `${file}#run`, name: 'run', path: 'run', source: true, testFiles: [FILE], startLine: 2, endLine: 2 },
    ],
  })),
};

const index = (distance: number, stopped = false): ExecutionIndex => ({
  tests: [{ id: `${FILE} > one`, file: FILE, name: 'one', stopped: false }, { id: `${FILE} > two`, file: FILE, name: 'two', stopped: false }, { id: `${FILE} > three`, file: FILE, name: 'three', stopped }],
  modules: [
    { file: 'src/used.ts', blocks: [{ kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true, crossings: [{ test: 0, distance }, { test: 1, distance: 0 }] }] },
    { file: 'src/unused.ts', blocks: [{ kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true, crossings: [{ test: 2, distance, loaded: true }] }] },
  ],
});

describe('readDistillRecords', () => {
  it('reads which modules no case of the file entered, and how many cases it holds', () => {
    const near = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0)) })]).file(FILE);

    expect(near.names[near.module[0]!]).toBe('src/unused.ts');
    expect([near.cases, near.unsettled]).toEqual([3, 0]);
  });

  it('counts a case the index holds as stopped as unsettled', () => {
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0, true)) })]).file(FILE);

    expect([sets.cases, sets.unsettled]).toEqual([3, 1]);
  });

  it('distills a row-spelled record the same as its set-spelled conversion, reading no depth', () => {
    const recorded = (spelled: Uint8Array) => readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: spelled })]);
    const [rows, sets] = [recorded(encodeExecutionIndex(index(1))), recorded(encodeAsSetExecutionIndex(index(0)))];

    expect(rows.file(FILE)).toEqual(sets.file(FILE));
    expect(rows.scope(undefined)).toEqual(sets.scope(undefined));
    expect(rows.regions(FILE, 'src/used.ts')).toEqual(sets.regions(FILE, 'src/used.ts'));
    expect(rows.cases(FILE)).toEqual(sets.cases(FILE));
  });

  it('reads an importer\'s regions against the file\'s cases, and a run at load as a flag that names no case', () => {
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0)) })]);
    const region = { kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true };

    expect(sets.regions(FILE, 'src/used.ts')).toEqual([{ ...region, ran: true, called: expect.any(Uint32Array), loaded: false }]);
    expect(sets.regions(FILE, 'src/used.ts')[0]!.called).toHaveLength(1);
    expect(sets.regions(FILE, 'src/unused.ts')).toEqual([{ ...region, ran: false, called: new Uint32Array(), loaded: true }]);
    expect(sets.regions(FILE, 'src/absent.ts')).toEqual([]);
    expect(sets.cases(FILE).map(({ name }) => name)).toEqual(['one', 'two', 'three']);
    expect(sets.cases('test/absent.test.ts')).toEqual([]);
  });

  it('refuses a record that holds cases and no coverage rows as reading its coverage would', () => {
    expect(() => readDistillRecords([recordOfCases({ index: encodeAsSetExecutionIndex(index(0)) })])).toThrow(RecordWithoutCoverage);
  });

  it('reads a module the case index lists twice by its last row, whichever question reaches it first', () => {
    const twice: ExecutionIndex = { ...index(0), modules: [...index(0).modules, { ...index(0).modules[0]!, blocks: [{ ...index(0).modules[0]!.blocks[0]!, crossings: [] }] }] };
    const recorded = () => readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(twice) })]);
    const alone = recorded().file(FILE);
    const afterScope = recorded();
    afterScope.scope(undefined);
    const entered = (found: typeof alone) => Array.from(found.module, (module, at) => [found.names[module], found.entered[at]]);

    expect(entered(alone)).toEqual(entered(afterScope.file(FILE)));
    expect(entered(alone)).toContainEqual(['src/used.ts', 0]);
  });
});

/** One record of every shape a coverage row reader has to agree on: what each test file loaded, its lines, and whether its row is complete. */
describe('the coverage rows the addon and openTestCoverage read', () => {
  const [A, B] = ['test/a.test.ts', 'test/b.test.ts'];
  const module = (file: string, loadedBy: readonly string[], shape: { instrumented?: boolean; source?: boolean; functions?: boolean; endLine?: number } = {}): CoverageModule => ({
    file, sourceDigest: file, instrumented: shape.instrumented ?? true,
    blocks: shape.instrumented === false ? [] : [
      { ordinal: 0, kind: 'module', digest: `${file}#root`, name: '', path: '', source: true, testFiles: [...loadedBy], loadedBy: [...loadedBy], ...(shape.endLine === undefined ? {} : { startLine: 1, endLine: shape.endLine }) },
      ...(shape.functions === false ? [] : [{ ordinal: 1, kind: 'function' as const, owner: 0, digest: `${file}#run`, name: 'run', path: 'run', source: shape.source ?? true, testFiles: [], startLine: 2, endLine: 2 }]),
    ],
  });
  const coverage: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{ file: A, complete: true, preconditions: [] }, { file: B, complete: false, preconditions: [] }],
    modules: [
      module('src/both.ts', [A, B], { endLine: 12 }),
      module('src/generated.ts', [A], { source: false, endLine: 30 }),
      module('src/raw.ts', [A], { instrumented: false, endLine: 40 }),
      module('src/top.ts', [A, B], { functions: false, endLine: 50 }),
      module('src/unlined.ts', [B]),
      module('src/b-only.ts', [B, B], { endLine: 7 }),
      module(A, [A], { endLine: 60 }),
    ],
  };
  const cases: ExecutionIndex = {
    tests: [A, B].map((file) => ({ id: `${file} > one`, file, name: 'one', stopped: false })),
    modules: [],
  };
  const bytes = withCaseSections(encodeTestCoverage(coverage), { index: encodeAsSetExecutionIndex(cases) });

  /** The reading `distill` made before the addon: an instrumented module with a source function, by the test files that ran its top level. */
  const oracle = (file: string) => {
    const decoded = decodeTestCoverage(bytes);
    const loaded = decoded.modules.filter((found) =>
      found.file !== file && found.instrumented &&
      found.blocks.some((block) => block.kind === 'function' && block.source) &&
      found.blocks.find((block) => block.kind === 'module')?.loadedBy?.includes(file));
    return {
      loaded: loaded.length,
      lines: loaded.reduce((sum, found) => sum + (found.blocks.find((block) => block.kind === 'module')?.endLine ?? 0), 0),
      complete: decoded.tests.find((test) => test.file === file)!.complete,
    };
  };

  it.each([A, B])('agree on %s', (file) => {
    const found = readDistillRecords([bytes]).file(file);

    expect({ loaded: found.loaded, lines: found.lines, complete: found.withheld !== 2 }).toEqual(oracle(file));
  });

  it('refuse a module whose regions disagree with whether it was instrumented', () => {
    const broken = encodeTestCoverage({ ...coverage, modules: [{ ...module('src/both.ts', [A], { endLine: 12 }), instrumented: false }] });

    expect(() => decodeTestCoverage(broken)).toThrow();
    expect(() => readDistillRecords([withCaseSections(broken, { index: encodeAsSetExecutionIndex(cases) })])).toThrow();
  });
});

describe('without the addon', () => {
  // Cut at the addon: what is under test is the refusal, and the loader's own reasons are `native.test.ts`'s.
  afterEach(() => {
    vi.doUnmock('../addon.js');
    vi.resetModules();
  });

  const absent = async () => {
    vi.resetModules();
    vi.doMock('../addon.js', () => ({ native: () => undefined, nativeRefusal: () => '@variance-authority/sense-linux-x64-gnu is not installed' }));
    return import('./distill-native.js');
  };

  it('refuses to read records, naming why the addon did not load', async () => {
    const { readDistillRecords: read } = await absent();
    expect(() => read([])).toThrow('distill reads its records with the native addon, which is unavailable: @variance-authority/sense-linux-x64-gnu is not installed');
  });

  it('refuses to rank causes, naming why the addon did not load', async () => {
    const { rankDistillCauses: rank } = await absent();
    expect(() => rank([])).toThrow('distill reads its records with the native addon, which is unavailable: @variance-authority/sense-linux-x64-gnu is not installed');
  });
});
