// compass: variance-authority/runtime/attention
import type { Relations } from '@variance-authority/core/relate';
import { readDistillRecords, type DistillRecords, type NativeDistillScope } from '@variance-authority/sense/test-selection';
import { withheldOf } from './file.js';
import { importOf, SHARED, UNSEEN } from './own.js';
import { fileTime, formatScopeTime, scopeTime, type FileTime, type ScopeTime } from './time.js';

/** One record a scope is read from, and the suite it belongs to when one is declared. */
export interface ScopeRecord {
  readonly suite?: string;
  /** The record as it is written: its coverage rows and its case index. */
  readonly record: Uint8Array;
}

/** What names a scope of test files, and the records it is read from. */
export interface ScopeDistillInput {
  /** A directory spelled from the repository root: a folder or a package. Absent, every test file the records hold. */
  readonly within?: string;
  readonly records: readonly ScopeRecord[];
  /** Declared suites with no record to read, named so a reading of every suite does not pass for one of all. */
  readonly unrecorded?: readonly string[];
  /** As {@link FileDistillInput.relations}: given, each spill is the import that brought its modules in. */
  readonly relations?: Relations;
}

/**
 * What brought a spill's modules in: one import, no one import (`shared`), or
 * no import the graph reads (`unseen`). A shared spill drops where each path
 * parts, which differs from one test file to the next.
 */
export type SpillCause =
  | { readonly kind: 'import'; readonly importer: string; readonly imported: string; readonly lazy?: true }
  | { readonly kind: 'shared' }
  | { readonly kind: 'unseen' };

/** Modules loaded and entered by no case of the test file that loaded them, gathered under one cause. */
export interface Spill {
  /** Absent when no file graph was given: the spill is then one module. */
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
  /** Imports heaviest first, then the shared and the unseen; with no file graph given, modules heaviest first. */
  readonly spills: readonly Spill[];
  /** Where the scope's worker time went, phase by phase. Absent when no test file of it reported its phases. */
  readonly time?: ScopeTime;
}

const read = new WeakMap<readonly ScopeRecord[], DistillRecords>();

/** The records read once, however many questions a scope asks of them. */
function recordsOf(records: readonly ScopeRecord[]): DistillRecords {
  let found = read.get(records);
  if (found === undefined) read.set(records, (found = readDistillRecords(records.map(({ record }) => record))));
  return found;
}

/** Each test file of the scope read on its own, record by record; refuses a scope that holds none. */
function scopeOf(input: ScopeDistillInput): { readonly within?: string; readonly scope: NativeDistillScope } {
  const within = input.within === undefined ? undefined : directoryOf(input.within);
  const scope = recordsOf(input.records).scope(within, input.relations);
  if (scope.readings.file.length === 0) {
    throw new Error(within === undefined ? 'The record holds no test file.' : `The record holds no test file under \`${within}\`.`);
  }
  return { ...(within === undefined ? {} : { within }), scope };
}

/** The scope's readings, one per test file, in reading order. */
function* readingsOf(input: ScopeDistillInput, scope: NativeDistillScope): Generator<ScopeRow, void, undefined> {
  const { readings, names } = scope;
  for (let at = 0; at < readings.file.length; at += 1) {
    const { suite, record } = input.records[readings.record[at]!]!;
    const file = names[readings.file[at]!]!;
    const cases = readings.cases[at]!;
    const time = fileTime(record, file);
    const withheld = withheldOf(file, readings.withheld[at]!, readings.unsettled[at]!, cases);
    yield {
      ...(suite === undefined ? {} : { suite }),
      file,
      cases,
      ...(time === undefined ? {} : { time }),
      loaded: { modules: readings.loaded[at]!, lines: readings.loadedLines[at]! },
      ...(withheld === undefined
        ? { unentered: { modules: readings.unentered[at]!, lines: readings.unenteredLines[at]! } }
        : { withheld }),
    };
  }
}

/** A spill's kind in the addon's columns: a module read with no graph, an import, shared, unseen. */
const IMPORT = 1;
const SHARED_KIND = 2;

/**
 * Read every test file of a scope as {@link distillFile} reads one, and gather
 * what each loaded for nothing under the import that brought it in.
 *
 * A test file evaluates its imports once, so an import costs its lines once in
 * every test file it reaches: the barrel that puts a hundred unused lines into
 * forty test files spills four thousand. Only what no case of the loading file
 * entered is gathered; a module some cases used is the file's own reading.
 * The records are read by the addon, in parallel, and the answer does not
 * depend on how that work was split.
 */
export function distillScope(input: ScopeDistillInput): ScopeDistillation {
  const { within, scope } = scopeOf(input);
  const name = (id: number): string => scope.names[id]!;
  const spills = Array.from(scope.kind, (kind, at): Spill => {
    const cause: SpillCause | undefined = kind === IMPORT
      ? {
        kind: 'import',
        importer: name(scope.importer[at]!),
        imported: name(scope.imported[at]!),
        ...(scope.lazy[at] === 1 ? { lazy: true as const } : {}),
      }
      : kind === SHARED_KIND ? { kind: 'shared' }
      : kind === 0 ? undefined
      : { kind: 'unseen' };
    return {
      ...(cause === undefined ? {} : { cause }),
      modules: Array.from(scope.modules.subarray(scope.moduleOffset[at]!, scope.moduleOffset[at + 1]!), name),
      files: Array.from(scope.files.subarray(scope.fileOffset[at]!, scope.fileOffset[at + 1]!), name),
      lines: scope.spillLines[at]!,
    };
  });
  // One pass over the rows, none of them kept: what the answer holds is their tally and the withheld.
  const withheld: { file: string; suite?: string; reason: string }[] = [];
  const suites = new Set<string>();
  const timed: { record: number; file: string }[] = [];
  let files = 0;
  for (const { suite, file, withheld: reason } of readingsOf(input, scope)) {
    timed.push({ record: scope.readings.record[files]!, file });
    files += 1;
    if (suite !== undefined) suites.add(suite);
    if (reason !== undefined) withheld.push({ file, ...(suite === undefined ? {} : { suite }), reason });
  }
  return {
    ...(within === undefined ? {} : { within }),
    suites: [...suites],
    ...(input.unrecorded === undefined || input.unrecorded.length === 0 ? {} : { unrecorded: input.unrecorded }),
    files,
    read: files - withheld.length,
    withheld,
    loads: scope.loads,
    lines: scope.lines,
    spills,
    ...timeOf(input.records, timed),
  };
}

function timeOf(records: readonly ScopeRecord[], files: readonly { record: number; file: string }[]): { time?: ScopeTime } {
  const time = scopeTime(records.map(({ record }) => record), files);
  return time === undefined ? {} : { time };
}

/** One test file of a scope: what it loaded, and what of that no case of it entered. */
export interface ScopeRow {
  readonly suite?: string;
  readonly file: string;
  /** How many cases the record keeps for the file. */
  readonly cases: number;
  /** Recorded worker milliseconds by phase, even when `unentered` is withheld. Absent when no phase was timed. */
  readonly time?: FileTime;
  /** The modules it loaded that declare a function, other than itself, and their lines. */
  readonly loaded: { readonly modules: number; readonly lines: number };
  /** Of those, the ones no case of the file entered. Absent when the reading is withheld. */
  readonly unentered?: { readonly modules: number; readonly lines: number };
  /** Why the file's cases cannot say what it did without. */
  readonly withheld?: string;
}

/**
 * Every test file of a scope, one row each, in the order {@link distillScope}
 * reads them: a row a test file at a time, for a reader that wants the
 * distribution across test files rather than the imports they share. The
 * records are read, and a scope that holds no test file refused, before it
 * returns; each row is made as it is reached.
 */
export function scopeRows(input: ScopeDistillInput): Generator<ScopeRow, void, undefined> {
  return readingsOf(input, scopeOf(input).scope);
}

/** `packages/app/`, `./packages/app` and `packages/app` name one directory. */
function directoryOf(raw: string): string | undefined {
  const trimmed = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed === '' || trimmed === '.' ? undefined : trimmed;
}

function headOf(spill: Spill): string {
  const cause = spill.cause;
  if (cause === undefined) return spill.modules[0]!;
  if (cause.kind === 'import') return importOf(cause);
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
  const byImport = (spill: Spill): boolean => spill.cause === undefined || spill.cause.kind === 'import';
  const imports = result.spills.filter(byImport);
  const rest = result.spills.filter((spill) => !byImport(spill));
  const folded = imports.slice(SPILLS_SHOWN);
  const withheld = result.withheld.slice(0, WITHHELD_SHOWN).map(({ file }) => file);
  return [
    head,
    '',
    ...(result.time === undefined ? [] : [...formatScopeTime(result.time, result.files), '']),
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
