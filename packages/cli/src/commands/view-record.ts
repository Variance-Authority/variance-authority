// compass: variance-authority.reach.crossings
/**
 * `coverage.bin` as tables: what the page `variance view` writes lists.
 *
 * Every row of every table is a row of the record, read when it is drawn, and
 * none is left out. Nothing is computed that the record does not hold, except
 * one relation read both ways: which test files and cases entered a region, and
 * which regions a test file or a case entered.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { columnBytes, NO_BLOB, NO_DURATION, NO_OWNER, openTestCoverage, PHASE_NAMES, RecordWithoutCoverage, sectionsOf, type OpenedSections, type TestCoverageView } from '@variance-authority/sense/record';
import { kindName, openCases, type Cases } from './view-cases.js';
import type { MachinesBeside } from '@variance-authority/sense';
import { openParts, type Parts } from './view-parts.js';
import { address, each, entered, enteredCounts, gathered, listed, once, ownerOf, rowsOf, span, unless, yes, type Detail, type Sets, type Table } from './view-rows.js';

/** The coverage half of a record. */
export interface CoverageTables {
  readonly commit?: string;
  readonly instrumentation: string;
  readonly tests: Table;
  readonly timeline: Table;
  readonly modules: Table;
  readonly regions: Table;
  readonly preconditions: Table;
  /** The machines the runs beside the record name, with the test files each ran; absent where none are read at its commit. */
  readonly machines?: Table;
  /** Why no machine is named, where runs were read and none could be. */
  readonly machinesUnread?: string;
  testDetail(path: string): Detail | undefined;
  moduleDetail(path: string): Detail | undefined;
  regionDetail(row: number): Detail | undefined;
}

/** One record, opened. */
export interface ViewRecord {
  readonly bytes: Uint8Array;
  readonly sections: OpenedSections;
  /** Absent where the record holds cases and no coverage. */
  readonly coverage?: CoverageTables;
  readonly cases?: Cases;
  readonly before?: Cases;
  readonly parts: Parts;
  /** Why the runs beside a record without coverage are counted against no test file. */
  readonly machinesUnread?: string;
}

/** The record at `bytes`, and the machines the runs beside it name. */
export function openRecord(bytes: Uint8Array, ran?: MachinesBeside): ViewRecord {
  const sections = sectionsOf(bytes);
  const part = (name: string) => (sections.found.has(name) ? columnBytes(sections, name).slice() : undefined);
  const index = (name: string, prefix: string, label: string) => {
    const held = part(name);
    return held === undefined ? undefined : openCases(held, prefix, label);
  };
  const cases = index('cases', '', 'Cases');
  const before = index('cases.before', 'before-', 'Cases before the last run');
  const parts = openParts(part, cases);
  let view: TestCoverageView | undefined;
  try {
    view = openTestCoverage(bytes);
  } catch (error) {
    if (!(error instanceof RecordWithoutCoverage)) throw error;
  }
  return {
    bytes,
    sections,
    parts,
    ...(view === undefined ? {} : { coverage: coverageTables(view, cases, ran) }),
    ...(view !== undefined || ran === undefined ? {} : { machinesUnread: 'unread' in ran ? ran.unread : 'the record holds no test files to count the machines against' }),
    ...(cases === undefined ? {} : { cases }),
    ...(before === undefined ? {} : { before }),
  };
}

function coverageTables(view: TestCoverageView, cases: Cases | undefined, ran: MachinesBeside | undefined): CoverageTables {
  const string = each((id) => view.string(id));
  const testCount = view.testPath.length;
  const testPath = (row: number) => string(view.testPath.at(row));
  const modulePath = (row: number) => string(view.modulePath.at(row));
  const starts = once(() => view.testStart?.all());
  const phases = once(() => view.testPhases?.all());
  const durations = once(() => view.testDuration?.all());
  const lanes = once(() => view.testLane?.all());
  const preconditions = once(() => view.testPreconditions.all());
  const moduleBlocks = once(() => view.moduleBlocks.all());
  const blockSet = once(() => view.blockSet.all());
  const sets: Sets = {
    size: view.crossings.size,
    has: (set, member) => view.crossings.has(set, member),
    count: each((set) => view.crossings.count(set)),
    members: (set) => view.crossings.members(set),
  };
  const perTest = once(() => enteredCounts(sets, blockSet(), testCount));
  const duration = (row: number) => unless(durations()?.[row], NO_DURATION);
  const lane = (row: number) => unless(lanes()?.[row], NO_DURATION);
  const phase = (row: number, at: number) => unless(phases()?.[row * PHASE_NAMES.length + at], NO_DURATION);
  const start = (row: number) => {
    const high = unless(starts()?.[row * 2 + 1], NO_DURATION);
    return high === undefined ? undefined : high * 2 ** 32 + starts()![row * 2]!;
  };
  const { on, unread } = machinesAt(ran);
  const tests: Table = {
    id: 'tests',
    label: 'Test files',
    hint: 'each test file the record holds',
    count: testCount,
    columns: [
      { name: 'test file', at: testPath, link: (row) => address('test', testPath(row)) },
      { name: 'took', as: 'ms', at: duration },
      ...PHASE_NAMES.map((name, at) => ({ name, as: 'ms' as const, at: (row: number) => phase(row, at) })),
      ...(view.testStart === undefined ? [] : [{ name: 'started', as: 'time' as const, at: start }]),
      ...(view.testLane === undefined ? [] : [{ name: 'worker', at: lane }]),
      ...(on === undefined ? [] : [{ name: 'machine', at: (row: number) => on[testPath(row)] }]),
      { name: 'cases held', at: (row) => cases?.ofFile(testPath(row)).length },
      { name: 'regions entered', at: (row) => perTest()[row] },
      { name: 'preconditions', at: (row) => preconditions()[row + 1]! - preconditions()[row]! },
      { name: 'complete', at: (row) => yes(view.testComplete.at(row)) },
    ],
  };
  const moduleRegions = (row: number) => moduleBlocks()[row + 1]! - moduleBlocks()[row]!;
  /** Every test file that entered any region of a module, in row order. */
  const moduleTests = each((row: number): readonly number[] => {
    const into = new Set<number>();
    for (const set of new Set(Array.from(span(moduleBlocks()[row]!, moduleBlocks()[row + 1]!), (block) => blockSet()[block]!))) for (const test of sets.members(set)) into.add(test);
    return [...into].sort((a, b) => a - b);
  });
  const modules: Table = {
    id: 'modules',
    label: 'Modules',
    hint: 'each source file the record holds',
    count: view.modulePath.length,
    columns: [
      { name: 'module', at: modulePath, link: (row) => address('module', modulePath(row)) },
      { name: 'regions', at: moduleRegions },
      { name: 'regions no test entered', at: (row) => span(moduleBlocks()[row]!, moduleBlocks()[row + 1]!).filter((block) => sets.count(blockSet()[block]!) === 0).length },
      { name: 'test files', at: (row) => (moduleRegions(row) === 0 ? undefined : moduleTests(row).length) },
      { name: 'instrumented', at: (row) => yes(view.moduleInstrumented.at(row)) },
      { name: 'source', at: (row) => string(view.moduleSource.at(row)) },
      { name: 'git blob', at: (row) => named(unless(view.moduleBlob?.at(row), NO_BLOB)) },
    ],
  };
  function named(id: number | undefined): string | undefined {
    return id === undefined ? undefined : string(id);
  }
  const moduleOf = (row: number) => ownerOf(moduleBlocks(), row);
  const columns = {
    kind: once(() => view.blockKind.all()),
    name: once(() => view.blockName.all()),
    path: once(() => view.blockPath.all()),
    start: once(() => view.blockStart.all()),
    end: once(() => view.blockEnd.all()),
    owner: once(() => view.blockOwner.all()),
    digest: once(() => view.blockDigest.all()),
    source: once(() => view.blockSource.all()),
    ordinal: once(() => view.blockOrdinal.all()),
    loaded: once(() => view.blockLoadedSet?.all()),
  };
  const lines = (row: number) => {
    const [from, to] = [columns.start()[row]!, columns.end()[row]!];
    return from === 0 ? undefined : from === to ? String(from) : `${from}-${to}`;
  };
  const regions: Table = {
    id: 'regions',
    label: 'Regions',
    hint: 'each function, branch and module body the record holds',
    count: view.blockKind.length,
    columns: [
      { name: 'module', at: (row) => modulePath(moduleOf(row)), link: (row) => address('module', modulePath(moduleOf(row))) },
      { name: 'kind', at: (row) => kindName(columns.kind()[row]!) },
      { name: 'name', at: (row) => string(columns.name()[row]!) || '(no name)', link: (row) => address('region', row) },
      { name: 'path', at: (row) => string(columns.path()[row]!) },
      { name: 'lines', at: lines },
      { name: 'test files', at: (row) => sets.count(blockSet()[row]!) },
      { name: 'loaded by', at: (row) => (columns.loaded() === undefined ? undefined : sets.count(columns.loaded()![row]!)) },
      { name: 'written in source', at: (row) => yes(columns.source()[row]!) },
      { name: 'ordinal', at: (row) => columns.ordinal()[row] },
      { name: 'digest', at: (row) => string(columns.digest()[row]!) },
    ],
  };
  const preconditionTable: Table = {
    id: 'preconditions',
    label: 'Preconditions',
    hint: 'each precondition a test file was recorded under',
    count: view.preconditionName.length,
    columns: [
      { name: 'precondition', at: (row) => string(view.preconditionName.at(row)) },
      { name: 'digest', at: (row) => string(view.preconditionDigest.at(row)) },
      { name: 'test file', at: (row) => testPath(ownerOf(preconditions(), row)), link: (row) => address('test', testPath(ownerOf(preconditions(), row))) },
    ],
  };
  const testRow = once(() => gathered(testCount, testPath));
  const moduleRow = once(() => gathered(view.modulePath.length, modulePath));
  return {
    ...(view.commit === undefined ? {} : { commit: view.commit }),
    instrumentation: view.instrumentation,
    tests,
    timeline: timeline(testCount, testPath, start, duration, lane, phase),
    modules,
    regions,
    preconditions: preconditionTable,
    ...(on === undefined ? {} : { machines: machinesTable(on, testCount, testPath) }),
    ...(unread === undefined ? {} : { machinesUnread: unread }),
    testDetail: (path) => {
      const row = testRow().get(path)?.[0];
      if (row === undefined) return undefined;
      return {
        title: path,
        facts: factsOf(tests, row, 1),
        tables: [
          ...(cases === undefined ? [] : [rowsOf(cases.tests, cases.ofFile(path), { id: 'of-file', label: 'Cases', hint: 'each case this file holds' })]),
          rowsOf(regions, entered(sets, blockSet(), row), { id: 'entered', label: 'Regions entered', hint: 'every region a run of this file entered' }),
          rowsOf(preconditionTable, span(preconditions()[row]!, preconditions()[row + 1]!), { id: 'under', label: 'Preconditions', hint: 'what this file was recorded under' }),
        ],
      };
    },
    moduleDetail: (path) => {
      const row = moduleRow().get(path)?.[0];
      if (row === undefined) return undefined;
      const blocks = span(moduleBlocks()[row]!, moduleBlocks()[row + 1]!);
      return {
        title: path,
        facts: factsOf(modules, row, 1),
        tables: [
          rowsOf(regions, blocks, { id: 'of-module', label: 'Regions', hint: 'every region of this file' }),
          rowsOf(tests, moduleTests(row), { id: 'into', label: 'Test files', hint: 'every test file that entered a region of this file' }),
          ...(cases === undefined ? [] : [rowsOf(cases.regions, cases.ofModule(path), { id: 'of-module-cases', label: 'Regions by case', hint: 'every region of this file the case index holds' })]),
        ],
      };
    },
    regionDetail: (row) => {
      if (!(row >= 0 && row < regions.count)) return undefined;
      const owner = unless(columns.owner()[row], NO_OWNER);
      const loaded = columns.loaded()?.[row];
      return {
        title: string(columns.name()[row]!) || `${kindName(columns.kind()[row]!)} in ${modulePath(moduleOf(row))}`,
        facts: [...factsOf(regions, row, 0), ['inside', owner === undefined ? undefined : string(columns.name()[moduleBlocks()[moduleOf(row)]! + owner]!)]],
        tables: [
          rowsOf(tests, sets.members(blockSet()[row]!), { id: 'by', label: 'Test files', hint: 'every test file whose run entered this region' }),
          ...(loaded === undefined ? [] : [rowsOf(tests, sets.members(loaded), { id: 'loaded-by', label: 'Loaded by', hint: 'every test file that entered this region while it loaded' })]),
        ],
      };
    },
  };
}

function factsOf(table: Table, row: number, from: number): Detail['facts'] {
  return table.columns.slice(from).map((column) => [column.name, column.at(row), column.as] as const);
}

/**
 * Every test file with a start and a cost, on the clock it ran on.
 *
 * The axis runs from the earliest start to the latest end. A file with no start
 * or no cost has no place on it, and the hint counts those.
 */
function timeline(
  count: number,
  path: (row: number) => string,
  start: (row: number) => number | undefined,
  cost: (row: number) => number | undefined,
  lane: (row: number) => number | undefined,
  phase: (row: number, at: number) => number | undefined,
): Table {
  const placed = span(0, count).filter((row) => start(row) !== undefined && cost(row) !== undefined);
  const order = Array.from(placed).sort((a, b) => (lane(a) ?? Infinity) - (lane(b) ?? Infinity) || start(a)! - start(b)!);
  let from = Infinity;
  let to = -Infinity;
  for (const row of order) {
    from = Math.min(from, start(row)!);
    to = Math.max(to, start(row)! + cost(row)!);
  }
  const whole = Math.max(to - from, 1);
  const share = (ms: number, of: number) => (ms / of) * 100;
  const columns: Table['columns'] = [
    { name: 'worker', at: lane },
    { name: 'test file', at: path, link: (row) => address('test', path(row)) },
    {
      name: 'on the clock',
      as: 'ms',
      at: (row) => start(row)! - from,
      bar: (row) => {
        const timed = PHASE_NAMES.flatMap((name, at) => {
          const ms = phase(row, at);
          return ms === undefined ? [] : [{ name, ms }];
        });
        const total = Math.max(timed.reduce((sum, part) => sum + part.ms, 0), cost(row)!, 1);
        return {
          left: share(start(row)! - from, whole),
          width: share(cost(row)!, whole),
          title: [path(row), ...timed.map((part) => `${part.name} ${part.ms} ms`)].join('\n'),
          parts: timed.map((part) => ({ name: part.name, share: share(part.ms, total) })),
        };
      },
    },
    { name: 'took', as: 'ms', at: cost },
  ];
  return {
    ...rowsOf({ id: 'timeline', label: 'Timeline', hint: '', count, columns }, order, { id: 'timeline', label: 'Timeline', hint: '' }),
    hint: order.length === count ? `${count} test files by worker` : `${order.length} of ${count} test files by worker; the record gives the others no start or no cost`,
  };
}

/** Each file's machine, where the runs named them; otherwise why none is named, where runs were read. */
function machinesAt(ran: MachinesBeside | undefined): { readonly on?: Readonly<Record<string, string>>; readonly unread?: string } {
  if (ran === undefined) return {};
  return 'unread' in ran ? { unread: ran.unread } : { on: ran.files };
}

const NONE_NAMED = '(none named)';

/** The machines `on` names, each with the test files of the record it ran, in code-unit order, the files no one machine is named for last. */
export function machineCounts(on: Readonly<Record<string, string>>, count: number, testPath: (row: number) => string): readonly (readonly [string, number])[] {
  const files = new Map<string, number>();
  for (let row = 0; row < count; row += 1) {
    const machine = on[testPath(row)] ?? NONE_NAMED;
    files.set(machine, (files.get(machine) ?? 0) + 1);
  }
  const named = [...files.keys()].filter((machine) => machine !== NONE_NAMED).sort(codeUnitOrder);
  return [...named, ...(files.has(NONE_NAMED) ? [NONE_NAMED] : [])].map((machine) => [machine, files.get(machine)!] as const);
}

/** The Overview's table of {@link machineCounts}. */
function machinesTable(on: Readonly<Record<string, string>>, count: number, testPath: (row: number) => string): Table {
  const rows = machineCounts(on, count, testPath);
  return listed({ id: 'machines', label: 'Machines', hint: 'the machine each test file ran on, as the runs beside the record name it' }, ['machine', 'test files'], rows);
}
