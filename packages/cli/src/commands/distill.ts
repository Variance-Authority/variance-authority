// compass: variance-authority/runtime/attention
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EDGE_KINDS, NODE_KINDS, idOf, type EdgeKind, type Relations } from '@variance-authority/core/relate';
import { parseEyesJournal } from '@variance-authority/eyes/archive';
import {
  distill,
  distillFile,
  distillScope,
  formatDistillation,
  formatFileDistillation,
  formatScopeDistillation,
  scopeRows,
  type Distillation,
  type EyesAttempt,
  type FileDistillation,
  type ScopeDistillInput,
  type ScopeDistillation,
  type ScopeRecord,
  type ScopeRow,
} from '@variance-authority/distill';
import {
  declaredSuites,
  decodeTestCoverage,
  importReferences,
  isEncodedExecutionIndex,
  RecordWithoutCoverage,
  recordedEyesOf,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { mayMock, shadowReach } from '@variance-authority/sense/taint';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { executionIndexOf, recordedExecutionFile } from './execution-input.js';
import { relationsFor } from './source-graph.js';
import { asOperator, nothingRecorded } from './suite-record.js';

export interface DistillOptions {
  /** The case's id, its exact title, or a part of the title. */
  readonly test?: string;
  /** A part of the test file's path, which narrows `test`; alone, the file to read. */
  readonly file?: string;
  /** With neither `test` nor `file`, the directory whose test files are read; absent, every test file. */
  readonly from?: string;
  /** The record to read; when unnamed, the one a reader of the checkout reads. */
  readonly execution?: string;
  /** The one declared suite whose record is read; with no case and no file named, absent reads every suite. */
  readonly suite?: string;
  /** The checkout whose record is read, and the root the record's paths are relative to. */
  readonly root: string;
}

/**
 * Read one case, or with `file` alone one test file, out of a record and
 * produce its deterministic distillation. With neither, every test file under
 * `from`, or every test file, of the suite named or of every declared suite.
 *
 * The record holds the case index and, when the run opted into Eyes, every
 * attempt's journal. A record named with `--execution` may also be a case
 * index on its own, which has no journals to read, and no coverage rows to
 * say what a test file loaded.
 */
export async function distillFiles(options: DistillOptions): Promise<Distillation | FileDistillation | ScopeDistillation> {
  if (options.test === undefined && options.file === undefined) return distillRecords(options);
  const record = options.execution ?? (await recordedExecutionFile(options.root, options.suite));
  // One read: the index and the journals are then one run's, whatever lands between.
  const bytes = await recordAt(record);
  try {
    const execution = executionIndexOf(bytes);
    if (options.test === undefined && options.file !== undefined) {
      const input = { file: options.file, execution, coverage: coverageOf(bytes, record) };
      const flat = distillFile(input);
      // The graph is read only when there is a load to give a cause, or a mock to hold against it: the scan costs more than the record.
      if (!flat.modules?.some(({ entered }) => entered === 0) && !(await mocksIn(options.root, flat.file))) return flat;
      const graph = await fileGraph(options.root);
      return distillFile({
        ...input,
        ...causesFrom(graph),
        references: (file) => importReferences(options.root, graph, file),
        shadows: (file) => shadowReach(graph, file),
      });
    }
    const section = recordedEyesOf(bytes);
    return distill({
      ...(options.test === undefined ? {} : { test: options.test }),
      ...(options.file === undefined ? {} : { file: options.file }),
      root: options.root,
      execution,
      ...(section === undefined ? {} : { eyes: journalsOf(section.journals), watched: section.watched }),
    });
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * A scope read across records: the one named, else every declared suite's,
 * else the repository's one. Every test file is read on its own, and the file
 * graph only once, when some file loaded a module no case of it entered.
 */
async function distillRecords(options: DistillOptions): Promise<ScopeDistillation> {
  const input = await scopeOf(options);
  const flat = asOperator(() => distillScope(input));
  if (flat.spills.length === 0) return flat;
  const graph = await fileGraph(options.root);
  return distillScope({ ...input, ...causesFrom(graph) });
}

/**
 * A scope read across records as {@link distillFiles} reads it with no case and
 * no file named, one row a test file; the suites that kept no record are named
 * beside the rows. No row names an import, so the file graph is not read.
 */
export async function distillRows(options: Omit<DistillOptions, 'test' | 'file'>): Promise<{
  readonly rows: readonly ScopeRow[];
  readonly unrecorded?: readonly string[];
}> {
  const input = await scopeOf(options);
  const rows = asOperator(() => [...scopeRows(input)]);
  return { rows, ...(input.unrecorded === undefined ? {} : { unrecorded: input.unrecorded }) };
}

/** The records a scope is read from, and the declared suites that kept none. */
async function scopeOf(options: Omit<DistillOptions, 'test' | 'file'>): Promise<ScopeDistillInput> {
  const named = options.execution !== undefined || options.suite !== undefined;
  const declared = named ? undefined : suitesOf(options.root);
  const records: ScopeRecord[] = [];
  const unrecorded: string[] = [];
  for (const suite of declared ?? [options.suite]) {
    let record: string;
    try {
      record = options.execution ?? (await recordedExecutionFile(options.root, suite));
    } catch (error) {
      // Every suite was asked for, and one that never ran is named, not a reason to read none.
      if (declared === undefined || !(error instanceof OperatorError) || error.kind !== 'unrecorded') throw error;
      unrecorded.push(suite!);
      continue;
    }
    const bytes = await recordAt(record);
    records.push({
      ...(suite === undefined ? {} : { suite }),
      execution: asOperator(() => executionIndexOf(bytes)),
      coverage: asOperator(() => coverageOf(bytes, record)),
    });
  }
  if (records.length === 0) throw nothingRecorded(options.root, unrecorded);
  return {
    ...(options.from === undefined ? {} : { within: options.from }),
    records,
    ...(unrecorded.length === 0 ? {} : { unrecorded }),
  };
}

/** A record's bytes, or the operator's refusal when nothing is recorded there. */
async function recordAt(record: string): Promise<Buffer> {
  if (!existsSync(record)) throw new OperatorError(`distill reads a record, and nothing is recorded at ${record}`);
  try {
    return await readFile(record);
  } catch (error) {
    throw new OperatorError(messageOf(error), { cause: error });
  }
}

/** The declared suites' names, or none when the repository records once. */
function suitesOf(root: string): readonly string[] | undefined {
  return asOperator(() => declaredSuites(root))?.map((suite) => suite.name);
}

/** Whether a test file's text may mock a module; one the checkout does not hold mocks nothing to read. */
async function mocksIn(root: string, file: string): Promise<boolean> {
  const path = join(root, file);
  return existsSync(path) && mayMock(await readFile(path, 'utf8'));
}

function fileGraph(root: string): Promise<Relations> {
  return relationsFor(root, ['.'], [], []);
}

/** The edges a runtime evaluates a module through on load: a dynamic import evaluates later, if at all. */
const LOADING = new Set((['imports', 'reexports', 'asset'] as const satisfies readonly EdgeKind[]).map((kind) => EDGE_KINDS.indexOf(kind)));
/** The edge a literal `import()` leaves: what it loads is paid when it runs. */
const LAZY = new Set([EDGE_KINDS.indexOf('dynamic')]);
const FILE = NODE_KINDS.indexOf('file');

/** The files each file reaches by one set of edge kinds, read from the file graph by the names the record uses. */
function importsOf(relations: Relations, through: ReadonlySet<number> = LOADING): (file: string) => readonly string[] {
  const { offset, target, kind } = relations.depends;
  return (file) => {
    const id = idOf(relations, 'file', file);
    if (id === undefined) return [];
    const found: string[] = [];
    for (let at = offset[id]!; at < offset[id + 1]!; at += 1) {
      if (through.has(kind[at]!) && relations.kinds[target[at]!] === FILE) found.push(relations.names[target[at]!]!);
    }
    return found;
  };
}

/** What a file reading needs from the file graph to name the import behind each load. */
function causesFrom(relations: Relations) {
  return { imports: importsOf(relations), lazy: importsOf(relations, LAZY), republishes: republishesOf(relations) };
}

const REEXPORTS = EDGE_KINDS.indexOf('reexports');

/** Whether every file a file loads statically, it re-exports: a barrel, as far as the file graph says. */
function republishesOf(relations: Relations): (file: string) => boolean {
  const { offset, target, kind } = relations.depends;
  return (file) => {
    const id = idOf(relations, 'file', file);
    if (id === undefined) return false;
    let any = false;
    for (let at = offset[id]!; at < offset[id + 1]!; at += 1) {
      if (!LOADING.has(kind[at]!) || relations.kinds[target[at]!] !== FILE) continue;
      if (kind[at] !== REEXPORTS) return false;
      any = true;
    }
    return any;
  };
}

/**
 * The coverage rows of a record, which say which test file loaded which module.
 * A case index on its own carries none, and a file reading has nothing to read;
 * a record whose rows do not decode is damaged, and says so.
 */
function coverageOf(bytes: Uint8Array, record: string): TestCoverage {
  const none = new OperatorError(
    `${record} holds no coverage rows, which say what a test file loaded; name a case with --test, or read a record`,
  );
  if (!isEncodedExecutionIndex(bytes)) throw none;
  try {
    return decodeTestCoverage(bytes);
  } catch (error) {
    if (error instanceof RecordWithoutCoverage) throw none;
    throw error;
  }
}

function journalsOf(journals: NonNullable<ReturnType<typeof recordedEyesOf>>['journals']): readonly EyesAttempt[] {
  return journals.map((row) => ({
    case: row.case,
    attempt: row.attempt,
    journal: parseEyesJournal(row.journal, `the Eyes journal of ${row.case}, attempt ${row.attempt}`),
  }));
}

export function formatDistill(result: Distillation | FileDistillation | ScopeDistillation, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(result, null, 2)}\n`;
  if ('test' in result) return `${formatDistillation(result)}\n`;
  return `${'spills' in result ? formatScopeDistillation(result) : formatFileDistillation(result)}\n`;
}
