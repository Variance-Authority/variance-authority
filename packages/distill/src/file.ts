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
   * file, so nothing says which case entered what.
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
 * tests; one only some cases entered is loaded for every case and used by a few.
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

/** The file's top level ran for `file`, and the module declares a function below it. */
function loadedBy(module: CoverageModule, file: string): boolean {
  const root = module.blocks.find((block) => block.kind === 'module');
  return root?.testFiles.includes(file) === true &&
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
    'A module no case entered was loaded for nothing this file tests: its import can be removed, mocked with a factory, ' +
      'or deferred to the code that uses it. One that some cases entered can be required where it is used. ' +
      'Rerun the file after the change: a top level can register something a case depends on.',
    ...(result.cases.length > 1 ? ['', 'Read one case with --test <id>:', ...casesShown(result.cases)] : []),
  ].join('\n');
}

function casesShown(cases: readonly ExecutionTest[]): readonly string[] {
  const shown = cases.slice(0, AVAILABLE_SHOWN).map(({ id }) => `  ${id}`);
  return cases.length > AVAILABLE_SHOWN ? [...shown, `  and ${cases.length - AVAILABLE_SHOWN} more.`] : shown;
}
