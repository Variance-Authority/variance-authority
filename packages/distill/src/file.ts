// compass: variance-authority/runtime/attention
import type {
  ExecutionIndex,
  ExecutionTest,
  TestCoverage,
} from '@variance-authority/sense/test-selection';
import { causesOf, type LoadCause } from './own.js';

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
  const file = testFileOf(input.coverage, input.file);
  const cases = input.execution.tests
    .map((test, at) => ({ test, at }))
    .filter(({ test }) => test.file === file);
  const candidates = input.coverage.modules.filter((module) => module.file !== file && module.instrumented && loadedBy(module, file));
  const base = { file, cases: cases.map(({ test }) => test), loaded: candidates.length };
  if (cases.length === 0) return { ...base, withheld: `the record keeps no cases for ${file}.` };
  if (input.coverage.tests.some((test) => test.file === file && !test.complete)) {
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
  const entries = new Map(input.execution.modules.map((module) => [module.file, enteredBy(module, mine)]));
  const entered = new Map(candidates.map((module) => [module.file, entries.get(module.file)?.size ?? 0]));
  const imports = input.imports;
  const cause = imports === undefined ? undefined : causesOf({ file, imports, coverage: input.coverage, entered });
  const modules = candidates
    .map((module): LoadedModule => {
      const lines = module.blocks.find((block) => block.kind === 'module')?.endLine;
      const count = entered.get(module.file)!;
      return {
        file: module.file,
        ...(lines === undefined ? {} : { lines }),
        entered: count,
        ...(cause === undefined || count > 0 ? {} : { cause: cause(module.file) }),
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

/** The file's top level ran for `file` before its first case, and the module declares a function below it. */
function loadedBy(module: CoverageModule, file: string): boolean {
  const root = module.blocks.find((block) => block.kind === 'module');
  return root?.loadedBy?.includes(file) === true &&
    module.blocks.some((block) => block.kind === 'function' && block.source);
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
      'use it: which case calls it does not change what the file loads. Mocking a listed module by its own path ties the test ' +
      'to an internal. Rerun the file after the change: a top level can register something a case depends on.',
    ...(result.cases.length > 1 ? ['', 'Read one case with --test <id>:', ...casesShown(result.cases)] : []),
  ].join('\n');
}

/** The modules grouped by what brought them in: imports heaviest first, then the shared, then the unseen. */
function byCause(modules: readonly LoadedModule[]): readonly (readonly [string, readonly LoadedModule[]])[] {
  const groups = new Map<string, LoadedModule[]>();
  for (const module of modules) {
    const cause = module.cause;
    const head = cause?.kind === 'import'
      ? `${cause.importer} imports ${cause.imported}`
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

const SHARED = 'No one import brings these in alone';
const UNSEEN = 'No static import reaches these from the test file';

function partsOf(cause: LoadCause | undefined): string {
  return cause?.kind === 'shared' ? `, every path to it runs through ${cause.parts}` : '';
}

function casesShown(cases: readonly ExecutionTest[]): readonly string[] {
  const shown = cases.slice(0, AVAILABLE_SHOWN).map(({ id }) => `  ${id}`);
  return cases.length > AVAILABLE_SHOWN ? [...shown, `  and ${cases.length - AVAILABLE_SHOWN} more.`] : shown;
}
