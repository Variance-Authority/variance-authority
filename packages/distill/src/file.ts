// compass: variance-authority/runtime/attention
import type {
  ExecutionIndex,
  ExecutionTest,
  TestCoverage,
} from '@variance-authority/sense/test-selection';

/** What names one test file, and the two readings of the record it is read from. */
export interface FileDistillInput {
  /** A part of the test file's path, as the record spells it. */
  readonly file: string;
  /** The record's case index: which cases entered which regions. */
  readonly execution: ExecutionIndex;
  /** The record's coverage rows: which test files loaded which modules. */
  readonly coverage: TestCoverage;
}

/** One module a test file loaded that not every one of its cases entered. */
export interface LoadedModule {
  readonly file: string;
  /** The module's length in lines. Absent when the record keeps no lines for its top level. */
  readonly lines?: number;
  /** How many of the file's cases entered a function the module declares. */
  readonly entered: number;
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
  const modules = candidates
    .map((module): LoadedModule => {
      const lines = module.blocks.find((block) => block.kind === 'module')?.endLine;
      return { file: module.file, ...(lines === undefined ? {} : { lines }), entered: entries.get(module.file)?.size ?? 0 };
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
    ...never.map((module) => `  ${module.file} — ${size(module)}`),
    '',
    `Loaded, and entered by some cases only: ${lines(some)}.`,
    ...some.map((module) => `  ${module.file} — ${size(module)}, entered by ${module.entered} of ${result.cases.length} case(s)`),
    '',
    'Each module is evidence, not the fix: the fix is the import, in this file or a module it used, that brought it in. ' +
      'Delete it, or mock it with a factory, when nothing behind it is used; when part is, import past the barrel ' +
      'inside its own package, or from an entry its package declares; ' +
      'make it lazy in the code that uses it, or move those cases to a file of their own, when only some cases ' +
      'use it: which case calls it does not change what the file loads. Mocking a listed module by its own path ties the test ' +
      'to an internal. Rerun the file after the change: a top level can register something a case depends on.',
    ...(result.cases.length > 1 ? ['', 'Read one case with --test <id>:', ...casesShown(result.cases)] : []),
  ].join('\n');
}

function casesShown(cases: readonly ExecutionTest[]): readonly string[] {
  const shown = cases.slice(0, AVAILABLE_SHOWN).map(({ id }) => `  ${id}`);
  return cases.length > AVAILABLE_SHOWN ? [...shown, `  and ${cases.length - AVAILABLE_SHOWN} more.`] : shown;
}
