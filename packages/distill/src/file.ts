// compass: variance-authority/runtime/attention
import type {
  ExecutionIndex,
  ExecutionTest,
  FileReferences,
  TestCoverage,
} from '@variance-authority/sense/test-selection';
import { chargeLine, chargesOf, reachLine } from './charge.js';
import { causesOf, importOf, SHARED, UNSEEN, type LoadCause } from './own.js';

/** What names one test file, and the two readings of the record it is read from. */
export interface FileDistillInput {
  /** A part of the test file's path, as the record spells it. */
  readonly file: string;
  /** The record's case index: which cases entered which regions. */
  readonly execution: ExecutionIndex;
  /** The record's coverage rows: which test files loaded which modules. */
  readonly coverage: TestCoverage;
  /**
   * The files a file imports statically — imports, re-exports and assets, not
   * dynamic imports — by the names the record uses. Given, each module no case
   * entered carries the import that made the file load it.
   */
  readonly imports?: (file: string) => readonly string[];
  /**
   * The files a file imports dynamically, by a quoted string. Given with
   * `imports`, what only a lazy import reaches is owned by it; unsaid, it
   * reads as unseen.
   */
  readonly lazy?: (file: string) => readonly string[];
  /**
   * Whether every file a file imports, it also re-exports: a barrel. Unsaid,
   * no file reads as one.
   */
  readonly republishes?: (file: string) => boolean;
  /**
   * Where a file references what it imports. Given with `imports`, each
   * static import a used file writes carries where that file reads it.
   */
  readonly references?: (file: string) => FileReferences | undefined;
}

/** One module a test file loaded that not every one of its cases entered. */
export interface LoadedModule {
  readonly file: string;
  /** The module's length in lines. Absent when the record keeps no lines for its top level. */
  readonly lines?: number;
  /** How many of the file's cases entered a function the module declares. */
  readonly entered: number;
  /** Why the file loaded it. Present for a module no case entered, when the imports were given. */
  readonly cause?: LoadCause;
}

/** What one test file loaded and how many of its cases used each module. */
export interface FileDistillation {
  readonly file: string;
  /** The file's cases, as the case index records them. */
  readonly cases: readonly ExecutionTest[];
  /** Modules the file loaded that declare a function, other than the test file itself. */
  readonly loaded: number;
  /**
   * The loaded modules fewer than all of the cases entered: none first, then
   * fewest, then longest. Absent when the case index keeps no cases for the
   * file, when a case stopped or did not say whether it finished, or when the
   * file's coverage row is incomplete: each leaves an entry unrecorded that a
   * finished, complete run would have recorded.
   */
  readonly modules?: readonly LoadedModule[];
  /** Present exactly when `modules` is absent: why. */
  readonly withheld?: string;
}

/**
 * Read one test file's loads against its cases' entries.
 *
 * A runner evaluates a module once per test file, so a load belongs to the
 * file, and the coverage rows say which file it was. A case is credited only
 * with what it called into, so the case index says which cases used the module
 * after it loaded. A module no case entered was loaded for nothing this file
 * tests; one only some cases entered is loaded once for the whole file and serves
 * a few of its cases.
 *
 * A module that declares nothing below its top level is left out: a barrel or
 * a file of constants runs all it has when it loads, and a read of a constant
 * is not recorded, so the record cannot say the file did without it. An
 * uninstrumented module is left out because the record cannot say what entered
 * it.
 */
export function distillFile(input: FileDistillInput): FileDistillation {
  return readTestFile(testFileOf(input.coverage, input.file), input);
}

/** {@link distillFile} for a test file named exactly as the record spells it. */
export function readTestFile(file: string, input: Omit<FileDistillInput, 'file'>): FileDistillation {
  const index = indexed(input.coverage, input.execution);
  const cases = index.cases.get(file) ?? [];
  const candidates = (index.loads.get(file) ?? []).filter((module) => module.file !== file);
  const base = { file, cases: cases.map(({ test }) => test), loaded: candidates.length };
  if (cases.length === 0) return { ...base, withheld: `the record keeps no cases for ${file}.` };
  if (index.incomplete.has(file)) {
    return {
      ...base,
      withheld: `the coverage row for ${file} is incomplete — a filtered, cancelled or stopped run, or source changed ` +
        'since it was recorded — so it cannot say what the file did without. Run the file again.',
    };
  }
  const unsettled = cases.filter(({ test }) => test.stopped !== false).length;
  if (unsettled > 0) {
    return {
      ...base,
      withheld: `${unsettled} of ${cases.length} case(s) stopped or did not say whether they finished, ` +
        'so what they would have entered is unknown.',
    };
  }

  const mine = new Set(cases.map(({ at }) => at));
  const entered = new Map(candidates.map((module) => {
    const executed = index.executed.get(module.file);
    return [module.file, executed === undefined ? 0 : enteredBy(executed, mine).size];
  }));
  const imports = input.imports;
  const cause = imports === undefined ? undefined : causesOf({
    file,
    imports,
    ...(input.lazy === undefined ? {} : { lazy: input.lazy }),
    ...(input.republishes === undefined ? {} : { republishes: input.republishes }),
    coverage: input.coverage,
    entered,
  });
  // Each file is read once however many owned modules ask for it, by the charge or for its exports.
  const read = new Map<string, FileReferences | undefined>();
  const references = input.references === undefined ? undefined : (at: string) => {
    if (!read.has(at)) read.set(at, input.references!(at));
    return read.get(at);
  };
  const charge = references === undefined ? undefined : chargesOf({
    references,
    coverage: input.coverage,
    execution: input.execution,
    mine,
  });
  const charged = (module: string): LoadCause => {
    const found = cause!(module);
    if (found.kind !== 'import' || found.lazy === true) return found;
    const reach = found.importer === file ? 'test' : imports!(file).includes(found.importer) ? 'subject' : 'beyond';
    const reading = charge?.(found.importer, found.imported);
    const exports = reach === 'subject' ? references?.(found.imported)?.exports : undefined;
    return { ...found, ...(reading === undefined ? {} : { charge: reading }), reach, ...(exports === undefined ? {} : { exports }) };
  };
  const modules = candidates
    .map((module): LoadedModule => {
      const lines = module.blocks.find((block) => block.kind === 'module')?.endLine;
      const count = entered.get(module.file)!;
      return {
        file: module.file,
        ...(lines === undefined ? {} : { lines }),
        entered: count,
        ...(cause === undefined || count > 0 ? {} : { cause: charged(module.file) }),
      };
    })
    .filter(({ entered }) => entered < cases.length)
    .sort((left, right) =>
      left.entered - right.entered ||
      (right.lines ?? -1) - (left.lines ?? -1) ||
      compare(left.file, right.file));
  return { ...base, modules };
}

type CoverageModule = TestCoverage['modules'][number];

/** A record's rows by the test file they belong to. */
interface Indexed {
  readonly cases: ReadonlyMap<string, readonly { readonly test: ExecutionTest; readonly at: number }[]>;
  readonly incomplete: ReadonlySet<string>;
  /** The instrumented modules each test file evaluated that declare a function below their top level. */
  readonly loads: ReadonlyMap<string, readonly CoverageModule[]>;
  readonly executed: ReadonlyMap<string, ExecutionIndex['modules'][number]>;
}

const indexes = new WeakMap<TestCoverage, WeakMap<ExecutionIndex, Indexed>>();

/** The record indexed once, however many of its test files are read. */
function indexed(coverage: TestCoverage, execution: ExecutionIndex): Indexed {
  let byExecution = indexes.get(coverage);
  if (byExecution === undefined) indexes.set(coverage, (byExecution = new WeakMap()));
  const found = byExecution.get(execution);
  if (found !== undefined) return found;
  const cases = new Map<string, { test: ExecutionTest; at: number }[]>();
  execution.tests.forEach((test, at) => push(cases, test.file, { test, at }));
  const loads = new Map<string, CoverageModule[]>();
  for (const module of coverage.modules) {
    if (!module.instrumented || !module.blocks.some((block) => block.kind === 'function' && block.source)) continue;
    // The file's top level ran for each of these test files before their first case.
    for (const file of new Set(module.blocks.find((block) => block.kind === 'module')?.loadedBy ?? [])) push(loads, file, module);
  }
  const index: Indexed = {
    cases,
    incomplete: new Set(coverage.tests.filter((test) => !test.complete).map((test) => test.file)),
    loads,
    executed: new Map(execution.modules.map((module) => [module.file, module])),
  };
  byExecution.set(execution, index);
  return index;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * The cases among `mine` that called into the module: crossed a region below
 * its root, other than while it evaluated.
 */
function enteredBy(module: ExecutionIndex['modules'][number], mine: ReadonlySet<number>): ReadonlySet<number> {
  const entered = new Set<number>();
  for (const block of module.blocks) {
    if (block.kind === 'module') continue;
    for (const crossing of block.crossings) {
      if (crossing.loaded !== true && mine.has(crossing.test)) entered.add(crossing.test);
    }
  }
  return entered;
}

/** How many test files a refusal names. */
const AVAILABLE_SHOWN = 5;

/** The one recorded test file the path part names: exactly, else the only one containing it. */
function testFileOf(coverage: TestCoverage, part: string): string {
  const files = coverage.tests.map((test) => test.file);
  if (files.includes(part)) return part;
  const found = files.filter((file) => file.includes(part)).sort(compare);
  if (found.length === 1) return found[0]!;
  if (found.length === 0) throw new Error(`The record holds no test file in \`${part}\`.`);
  const shown = found.slice(0, AVAILABLE_SHOWN).join(', ');
  const more = found.length > AVAILABLE_SHOWN ? `, and ${found.length - AVAILABLE_SHOWN} more` : '';
  throw new Error(`${found.length} recorded test files in \`${part}\`: ${shown}${more}; name one`);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Render a file distillation for a person or agent. */
export function formatFileDistillation(result: FileDistillation): string {
  const head = `${result.file}: ${result.cases.length} case(s); ${result.loaded} loaded module(s) declare functions.`;
  if (result.modules === undefined) return [head, `Loaded but not entered: unmeasured; ${result.withheld}`].join('\n');
  const never = result.modules.filter(({ entered }) => entered === 0);
  const some = result.modules.filter(({ entered }) => entered > 0);
  const lines = (modules: readonly LoadedModule[]): string => {
    const total = modules.reduce((sum, module) => sum + (module.lines ?? 0), 0);
    return `${modules.length} module(s), ${total} line(s)`;
  };
  const size = (module: LoadedModule): string => (module.lines === undefined ? 'lines not recorded' : `${module.lines} line(s)`);
  return [
    head,
    '',
    `Loaded, and entered by no case: ${lines(never)}.`,
    ...(never.some(({ cause }) => cause !== undefined)
      ? groupsShown(byCause(never)).flatMap(([head, modules, shown]) => [
        `  ${head}: ${lines(modules)}`,
        ...chargedOf(result.file, modules, shown),
        ...(shown
          ? listed(modules, MODULES_SHOWN, '    ', lines, (module) => `${module.file} — ${size(module)}${partsOf(module.cause)}`)
          : []),
      ])
      : listed(never, LISTED_SHOWN, '  ', lines, (module) => `${module.file} — ${size(module)}`)),
    '',
    `Loaded, and entered by some cases only: ${lines(some)}.`,
    ...listed(some, LISTED_SHOWN, '  ', lines, (module) =>
      `${module.file} — ${size(module)}, entered by ${module.entered} of ${result.cases.length} case(s)`),
    '',
    (never.some(({ cause }) => cause !== undefined)
      ? 'Each module is evidence, not the fix: the fix is the import named above it. '
      : 'Each module is evidence, not the fix: the fix is the import, in this file or a module it used, that brought it in. ') +
      'Delete it, or mock it with a factory, when nothing behind it is used; when part is, import past the barrel ' +
      'inside its own package, or from an entry its package declares; ' +
      'make it lazy in the code that uses it, or move those cases to a file of their own, when only some cases ' +
      'use it: which case calls it does not change what the file loads. Mock only what this file\'s subject imports: a module ' +
      'further away is an internal of code the test does not import. Rerun the file after the change: a top level can register something a case depends on.',
    ...(result.cases.length > 1 ? ['', 'Read one case with --test <id>:', ...casesShown(result.cases)] : []),
  ].join('\n');
}

/** The modules grouped by what brought them in: imports heaviest first, then the shared, then the unseen. */
function byCause(modules: readonly LoadedModule[]): readonly (readonly [string, readonly LoadedModule[]])[] {
  const groups = new Map<string, LoadedModule[]>();
  for (const module of modules) {
    const cause = module.cause;
    const head = cause?.kind === 'import'
      ? importOf(cause)
      : cause?.kind === 'shared' ? SHARED : UNSEEN;
    const group = groups.get(head);
    if (group === undefined) groups.set(head, [module]);
    else group.push(module);
  }
  const weight = (group: readonly LoadedModule[]): number => group.reduce((sum, module) => sum + (module.lines ?? 0), 0);
  const rank = (head: string): number => (head === SHARED ? 1 : head === UNSEEN ? 2 : 0);
  return [...groups].sort(([left, a], [right, b]) =>
    rank(left) - rank(right) || weight(b) - weight(a) || compare(left, right));
}

/** How many imports, modules under one group, and modules in a flat list the text names; the JSON names every one. */
const IMPORTS_SHOWN = 10;
const MODULES_SHOWN = 3;
const LISTED_SHOWN = 10;

type Group = readonly [string, readonly LoadedModule[]];

/**
 * The heaviest imports, then the shared and the unseen. The imports past the
 * first ones fold into one group whose modules are not listed.
 */
function groupsShown(groups: readonly Group[]): readonly (readonly [string, readonly LoadedModule[], boolean])[] {
  const imports = groups.filter(([head]) => head !== SHARED && head !== UNSEEN);
  const listed = (group: Group) => [...group, true] as const;
  if (imports.length <= IMPORTS_SHOWN) return groups.map(listed);
  const rest = imports.slice(IMPORTS_SHOWN);
  return [
    ...imports.slice(0, IMPORTS_SHOWN).map(listed),
    [`and ${rest.length} more import(s)`, rest.flatMap(([, modules]) => modules), false] as const,
    ...groups.slice(imports.length).map(listed),
  ];
}

/** The first `count` modules, then one line that sums the rest. */
function listed(
  modules: readonly LoadedModule[],
  count: number,
  indent: string,
  lines: (modules: readonly LoadedModule[]) => string,
  line: (module: LoadedModule) => string,
): readonly string[] {
  const head = modules.slice(0, count).map((module) => indent + line(module));
  if (modules.length <= count) return head;
  return [...head, `${indent}and ${modules.length - count} more: ${lines(modules.slice(count))}`];
}

/** Where the importer of a listed group reads its import, and what this file can do about it, under the group's head. */
function chargedOf(file: string, modules: readonly LoadedModule[], shown: boolean): readonly string[] {
  const cause = modules[0]?.cause;
  if (!shown || cause?.kind !== 'import') return [];
  const charged = cause.charge === undefined ? [] : [chargeLine(cause.importer, cause.imported, cause.charge)];
  const line = cause.reach === undefined ? undefined : reachLine(file, { ...cause, reach: cause.reach });
  const reached = line === undefined ? [] : [line];
  // The test file's own import is an error, said before where it reads it.
  return (cause.reach === 'test' ? [...reached, ...charged] : [...charged, ...reached]).map((line) => `    ${line}`);
}

function partsOf(cause: LoadCause | undefined): string {
  return cause?.kind === 'shared' ? `, every path to it runs through ${cause.parts}` : '';
}

function casesShown(cases: readonly ExecutionTest[]): readonly string[] {
  const shown = cases.slice(0, AVAILABLE_SHOWN).map(({ id }) => `  ${id}`);
  return cases.length > AVAILABLE_SHOWN ? [...shown, `  and ${cases.length - AVAILABLE_SHOWN} more.`] : shown;
}
