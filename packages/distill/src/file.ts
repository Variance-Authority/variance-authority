// compass: variance-authority/runtime/attention
import type { Relations } from '@variance-authority/core/relate';
import {
  rankDistillCauses,
  readDistillRecords,
  type DistillRecords,
  type ExecutionTest,
  type FileReferences,
  type NativeDistillCause,
  type NativeDistillFile,
} from '@variance-authority/sense/test-selection';
import type { ShadowReach } from '@variance-authority/sense/taint';
import { chargeLine, chargesOf, reachLine } from './charge.js';
import { misplacedLines, misplacedOf, type MisplacedMock } from './mocks.js';
import { importOf, SHARED, UNSEEN, type LoadCause } from './own.js';

/** What names one test file, and the record it is read from. */
export interface FileDistillInput {
  /**
   * The test file's repository-relative path, as the record spells it. Only
   * that file is read: a recorded path that contains it or ends in it is
   * another file.
   */
  readonly file: string;
  /** The record as it is written: its coverage rows, which say which test files loaded which modules, and its case index. */
  readonly record: Uint8Array;
  /**
   * The file graph, by the names the record uses. Given, each module no case
   * entered carries the import that made the file load it: imports, re-exports
   * and assets load a module, a literal `import()` owns what only it reaches,
   * and a file that re-exports all it loads is a barrel.
   */
  readonly relations?: Relations;
  /**
   * Where a file references what it imports. Given with `relations`, each
   * static import a used file writes carries where that file reads it.
   */
  readonly references?: (file: string) => FileReferences | undefined;
  /**
   * The modules a file mocks, each with its distance from the file on the
   * import graph. Given, each mock of a module the file does not load, or past
   * its subject's imports, is named.
   */
  readonly shadows?: (file: string) => readonly ShadowReach[];
}

/** One module a test file loaded that not every one of its cases entered. */
export interface LoadedModule {
  readonly file: string;
  /** The module's length in lines. Absent when the record keeps no lines for its top level. */
  readonly lines?: number;
  /** How many of the file's cases entered a function the module declares. */
  readonly entered: number;
  /** Why the file loaded it. Present for a module no case entered, when the file graph was given. */
  readonly cause?: LoadCause;
}

/** What one test file loaded and how many of its cases used each module. */
export interface FileDistillation {
  readonly file: string;
  /** The file's cases, as the case index records them. */
  readonly cases: readonly ExecutionTest[];
  /** Modules the file loaded that declare a function, other than the test file itself. */
  readonly loaded: number;
  /** Their lines, summed; a module whose top level kept no lines counts none. */
  readonly lines: number;
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
  /** The mocks the import graph argues against, read from the graph alone. Absent when there are none or no shadows were given. */
  readonly mocks?: readonly MisplacedMock[];
}

/** A reading's withheld code, as the addon spells it. */
const NO_CASES = 1;
const INCOMPLETE = 2;
const UNSETTLED = 3;

/** Why a reading is withheld, by its code; nothing when it was read. */
export function withheldOf(file: string, code: number, unsettled: number, cases: number): string | undefined {
  switch (code) {
    case NO_CASES:
      return `the record keeps no cases for ${file}.`;
    case INCOMPLETE:
      return `the coverage row for ${file} is incomplete — a filtered, cancelled or stopped run, or source changed ` +
        'since it was recorded — so it cannot say what the file did without.';
    case UNSETTLED:
      return `${unsettled} of ${cases} case(s) stopped or did not say whether they finished, ` +
        'so what they would have entered is unknown.';
    default:
      return undefined;
  }
}

const read = new WeakMap<Uint8Array, DistillRecords>();

/** The record read once, however many times one of its test files is asked. */
function recordOf(bytes: Uint8Array): DistillRecords {
  let found = read.get(bytes);
  if (found === undefined) read.set(bytes, (found = readDistillRecords([bytes])));
  return found;
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
 * it. The reading is the addon's (`native/src/distill_gather.rs` in
 * `@variance-authority/sense`).
 */
export function distillFile(input: FileDistillInput): FileDistillation {
  const file = input.file;
  const record = recordOf(input.record);
  const found = record.file(file, input.relations);
  // A refusal names no other path: two paths are two files, so none the record holds is the one asked.
  if (!found.held) {
    throw new Error(
      `The record holds no test file \`${file}\`. It names each test file by its path from the repository root, with \`/\`.`,
    );
  }
  const mocks = input.shadows === undefined ? [] : misplacedOf(input.shadows(file));
  const base = {
    file,
    cases: record.cases(file),
    loaded: found.loaded,
    lines: found.lines,
    ...(mocks.length === 0 ? {} : { mocks }),
  };
  const withheld = withheldOf(file, found.withheld, found.unsettled, found.cases);
  if (withheld !== undefined) return { ...base, withheld };

  const name = (id: number): string => found.names[id]!;
  const loading = new Map<string, number>();
  for (let at = 0; at < found.module.length; at += 1) {
    if (found.kind[at] === IMPORT) loading.set(name(found.importer[at]!), found.loading[at]!);
  }
  // Each file is read once however many owned modules ask for it, by the charge or for its exports.
  const references = input.references === undefined ? undefined : once(input.references);
  const charge = references === undefined || input.relations === undefined ? undefined : chargesOf({
    references,
    loading: (importer) => loading.get(importer) ?? 0,
    regions: once((importer) => record.regions(file, importer)),
  });
  const subjects = new Set(Array.from(found.subjects, name));
  const charged = (cause: LoadCause): LoadCause => {
    if (cause.kind !== 'import' || cause.lazy === true) return cause;
    const reach = cause.importer === file ? 'test' : subjects.has(cause.importer) ? 'subject' : 'beyond';
    const reading = charge?.(cause.importer, cause.imported);
    const exports = reach === 'subject' ? references?.(cause.imported)?.exports : undefined;
    return { ...cause, ...(reading === undefined ? {} : { charge: reading }), reach, ...(exports === undefined ? {} : { exports }) };
  };
  const modules = Array.from(found.module, (module, at): LoadedModule => {
    const cause = causeOf(found, at, name);
    return {
      file: name(module),
      ...(found.hasLines[at] === 1 ? { lines: found.moduleLines[at]! } : {}),
      entered: found.entered[at]!,
      ...(cause === undefined ? {} : { cause: charged(cause) }),
    };
  });
  return { ...base, modules };
}

/** A cause's kind in the addon's columns: none, an import, shared, unseen. */
const IMPORT = 1;
const SHARED_KIND = 2;
const UNSEEN_KIND = 3;

function causeOf(found: NativeDistillFile, at: number, name: (id: number) => string): LoadCause | undefined {
  switch (found.kind[at]) {
    case IMPORT:
      return {
        kind: 'import',
        importer: name(found.importer[at]!),
        imported: name(found.imported[at]!),
        ...(found.lazy[at] === 1 ? { lazy: true as const } : {}),
      };
    case SHARED_KIND:
      return { kind: 'shared', parts: name(found.imported[at]!) };
    case UNSEEN_KIND:
      return { kind: 'unseen' };
    default:
      return undefined;
  }
}

function once<T>(ask: (file: string) => T): (file: string) => T {
  const asked = new Map<string, T>();
  return (file) => {
    if (!asked.has(file)) asked.set(file, ask(file));
    return asked.get(file)!;
  };
}

/** How many cases a refusal names. */
const AVAILABLE_SHOWN = 5;

/** Render a file distillation for a person or agent. */
export function formatFileDistillation(result: FileDistillation): string {
  // The mocks are read from the graph, not the record, so they stand however the loads read.
  const head = [
    `${result.file}: ${result.cases.length} case(s); ${result.loaded} loaded module(s) declare functions.`,
    ...(result.mocks === undefined ? [] : ['', ...misplacedLines(result.file, result.mocks)]),
  ].join('\n');
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

/** The modules grouped by what brought them in, in the order a scope reads its spills: imports heaviest first, then the shared, then the unseen. */
function byCause(modules: readonly LoadedModule[]): readonly (readonly [string, readonly LoadedModule[]])[] {
  const groups = new Map<string, { readonly head: string; readonly cause: NativeDistillCause; readonly modules: LoadedModule[] }>();
  for (const module of modules) {
    const cause = module.cause;
    const [head, kind] = cause?.kind === 'import'
      ? [importOf(cause), IMPORT]
      : cause?.kind === 'shared' ? [SHARED, SHARED_KIND] : [UNSEEN, UNSEEN_KIND];
    let group = groups.get(head);
    if (group === undefined) {
      const named = cause?.kind === 'import'
        ? { importer: cause.importer, imported: cause.imported, lazy: cause.lazy === true }
        : { importer: '', imported: '', lazy: false };
      groups.set(head, (group = { head, cause: { kind, ...named, lines: 0 }, modules: [] }));
    }
    group.modules.push(module);
  }
  const held = [...groups.values()];
  const weight = (group: readonly LoadedModule[]): number => group.reduce((sum, module) => sum + (module.lines ?? 0), 0);
  return rankDistillCauses(held.map(({ cause, modules }) => ({ ...cause, lines: weight(modules) })))
    .map((at) => [held[at]!.head, held[at]!.modules] as const);
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
