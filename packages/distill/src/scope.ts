// compass: variance-authority/runtime/attention
import type { ExecutionIndex, TestCoverage } from '@variance-authority/sense/test-selection';
import { readTestFile, type FileDistillation } from './file.js';

/** One record a scope is read from, and the suite it belongs to when one is declared. */
export interface ScopeRecord {
  readonly suite?: string;
  readonly execution: ExecutionIndex;
  readonly coverage: TestCoverage;
}

/** What names a scope of test files, and the records it is read from. */
export interface ScopeDistillInput {
  /** A directory spelled from the repository root: a folder or a package. Absent, every test file the records hold. */
  readonly within?: string;
  readonly records: readonly ScopeRecord[];
  /** Declared suites with no record to read, named so a reading of every suite does not pass for one of all. */
  readonly unrecorded?: readonly string[];
  /** As {@link FileDistillInput.imports}: given, each spill is the import that brought its modules in. */
  readonly imports?: (file: string) => readonly string[];
  /** As {@link FileDistillInput.republishes}. */
  readonly republishes?: (file: string) => boolean;
}

/**
 * What brought a spill's modules in: one import, no one import (`shared`), or
 * no static import (`unseen`). A shared spill drops where each path parts,
 * which differs from one test file to the next.
 */
export type SpillCause =
  | { readonly kind: 'import'; readonly importer: string; readonly imported: string }
  | { readonly kind: 'shared' }
  | { readonly kind: 'unseen' };

/** Modules loaded and entered by no case of the test file that loaded them, gathered under one cause. */
export interface Spill {
  /** Absent when no imports were given: the spill is then one module. */
  readonly cause?: SpillCause;
  readonly modules: readonly string[];
  /** The test files that loaded them. */
  readonly files: readonly string[];
  /** Their lines, counted once for each test file that loaded them: each file evaluates its imports anew. */
  readonly lines: number;
}

/** What a scope of test files loaded and no case of the loading file entered. */
export interface ScopeDistillation {
  readonly within?: string;
  /** The suites holding a test file in the scope, when the records name them. */
  readonly suites: readonly string[];
  /** Declared suites that kept no record, and so were not read. */
  readonly unrecorded?: readonly string[];
  /** The test files in the scope. */
  readonly files: number;
  /** The test files whose reading was not withheld. */
  readonly read: number;
  readonly withheld: readonly { readonly file: string; readonly suite?: string; readonly reason: string }[];
  /** Modules counted once for each test file that loaded them and entered none. */
  readonly loads: number;
  /** Their lines, counted the same way. */
  readonly lines: number;
  /** Imports heaviest first, then the shared and the unseen; with no imports given, modules heaviest first. */
  readonly spills: readonly Spill[];
}

/**
 * Read every test file of a scope as {@link distillFile} reads one, and gather
 * what each loaded for nothing under the import that brought it in.
 *
 * A test file evaluates its imports once, so an import costs its lines once in
 * every test file it reaches: the barrel that puts a hundred unused lines into
 * forty test files spills four thousand. Only what no case of the loading file
 * entered is gathered; a module some cases used is the file's own reading.
 */
export function distillScope(input: ScopeDistillInput): ScopeDistillation {
  const within = input.within === undefined ? undefined : directoryOf(input.within);
  const inside = (file: string): boolean => within === undefined || file.startsWith(`${within}/`);
  const readings: { readonly suite?: string; readonly reading: FileDistillation }[] = [];
  for (const record of input.records) {
    const files = [...new Set(record.coverage.tests.map((test) => test.file))].filter(inside).sort(compare);
    for (const file of files) {
      const reading = readTestFile(file, {
        execution: record.execution,
        coverage: record.coverage,
        ...(input.imports === undefined ? {} : { imports: input.imports }),
        ...(input.republishes === undefined ? {} : { republishes: input.republishes }),
      });
      readings.push({ ...(record.suite === undefined ? {} : { suite: record.suite }), reading });
    }
  }
  if (readings.length === 0) {
    throw new Error(within === undefined ? 'The record holds no test file.' : `The record holds no test file under \`${within}\`.`);
  }

  const gathered = new Map<string, { cause?: SpillCause; modules: Set<string>; files: Set<string>; lines: number }>();
  let loads = 0;
  let lines = 0;
  for (const { reading } of readings) {
    for (const module of reading.modules ?? []) {
      if (module.entered > 0) continue;
      const cause: SpillCause | undefined = module.cause === undefined
        ? undefined
        : module.cause.kind === 'shared' ? { kind: 'shared' } : module.cause;
      const key = cause === undefined ? `module ${module.file}` : cause.kind === 'import' ? `import ${cause.importer} ${cause.imported}` : cause.kind;
      let spill = gathered.get(key);
      if (spill === undefined) {
        gathered.set(key, (spill = { ...(cause === undefined ? {} : { cause }), modules: new Set(), files: new Set(), lines: 0 }));
      }
      spill.modules.add(module.file);
      spill.files.add(reading.file);
      spill.lines += module.lines ?? 0;
      loads += 1;
      lines += module.lines ?? 0;
    }
  }
  const rank = (spill: Spill): number => (spill.cause?.kind === 'shared' ? 1 : spill.cause?.kind === 'unseen' ? 2 : 0);
  const spills = [...gathered.values()]
    .map((spill): Spill => ({
      ...(spill.cause === undefined ? {} : { cause: spill.cause }),
      modules: [...spill.modules].sort(compare),
      files: [...spill.files].sort(compare),
      lines: spill.lines,
    }))
    .sort((left, right) =>
      rank(left) - rank(right) || right.lines - left.lines || right.files.length - left.files.length ||
      compare(headOf(left), headOf(right)));

  const withheld = readings.flatMap(({ suite, reading }) =>
    reading.withheld === undefined ? [] : [{ file: reading.file, ...(suite === undefined ? {} : { suite }), reason: reading.withheld }]);
  return {
    ...(within === undefined ? {} : { within }),
    suites: [...new Set(readings.flatMap(({ suite }) => (suite === undefined ? [] : [suite])))],
    ...(input.unrecorded === undefined || input.unrecorded.length === 0 ? {} : { unrecorded: input.unrecorded }),
    files: readings.length,
    read: readings.length - withheld.length,
    withheld,
    loads,
    lines,
    spills,
  };
}

/** `packages/app/`, `./packages/app` and `packages/app` name one directory. */
function directoryOf(raw: string): string | undefined {
  const trimmed = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed === '' || trimmed === '.' ? undefined : trimmed;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SHARED = 'No one import brings these in alone';
const UNSEEN = 'No static import reaches these from the test file';

function headOf(spill: Spill): string {
  const cause = spill.cause;
  if (cause === undefined) return spill.modules[0]!;
  if (cause.kind === 'import') return `${cause.importer} imports ${cause.imported}`;
  return cause.kind === 'shared' ? SHARED : UNSEEN;
}

/** How many imports, and how many withheld test files, the text names; the JSON names every one. */
const SPILLS_SHOWN = 10;
const WITHHELD_SHOWN = 5;

/** Render a scope distillation for a person or agent. */
export function formatScopeDistillation(result: ScopeDistillation): string {
  const scope = [
    result.within ?? 'every test file',
    ...(result.suites.length === 0 ? [] : [`in ${result.suites.length === 1 ? 'suite' : 'suites'} ${result.suites.join(', ')}`]),
  ].join(' ');
  const head = result.withheld.length === 0
    ? `${scope}: ${result.files} test file(s), each read.`
    : `${scope}: ${result.files} test file(s); ${result.read} read, ${result.withheld.length} withheld.`;
  const size = (spills: readonly Spill[]): string => {
    const modules = new Set(spills.flatMap((spill) => spill.modules)).size;
    const files = new Set(spills.flatMap((spill) => spill.files)).size;
    return `${modules} module(s) in ${files} test file(s), ${spills.reduce((sum, spill) => sum + spill.lines, 0)} line(s)`;
  };
  const imports = result.spills.filter((spill) => spill.cause === undefined || spill.cause.kind === 'import');
  const rest = result.spills.slice(imports.length);
  const folded = imports.slice(SPILLS_SHOWN);
  const withheld = result.withheld.slice(0, WITHHELD_SHOWN).map(({ file }) => file);
  return [
    head,
    '',
    `Loaded, and entered by no case of the test file that loaded it: ${result.loads} module load(s), ${result.lines} line(s).`,
    ...imports.slice(0, SPILLS_SHOWN).map((spill) => `  ${headOf(spill)}: ${size([spill])}`),
    ...(folded.length === 0 ? [] : [`  and ${folded.length} more: ${size(folded)}`]),
    ...rest.map((spill) => `  ${headOf(spill)}: ${size([spill])}`),
    ...(result.unrecorded === undefined
      ? []
      : ['', `Not recorded: ${result.unrecorded.length === 1 ? 'suite' : 'suites'} ${result.unrecorded.join(', ')}.`]),
    ...(result.withheld.length === 0
      ? []
      : ['', `Withheld: ${[...withheld, ...(result.withheld.length > WITHHELD_SHOWN ? [`and ${result.withheld.length - WITHHELD_SHOWN} more`] : [])].join(', ')}; ` +
        'a test file read alone says why.']),
    '',
    'An import counts its lines once in every test file it reaches: each file evaluates its imports anew. ' +
      'Read one test file with --file <path> for the modules under each import, and for those only some of its cases used.',
  ].join('\n');
}
