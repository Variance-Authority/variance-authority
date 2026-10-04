// compass: variance-authority/runtime/attention
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EDGE_KINDS, NODE_KINDS, idOf, type EdgeKind, type Relations } from '@variance-authority/core/relate';
import { parseEyesJournal } from '@variance-authority/eyes/archive';
import {
  distill,
  distillFile,
  distillScope,
  formatDistillation,
  formatFileDistillation,
  formatScopeDistillation,
  type Distillation,
  type EyesAttempt,
  type FileDistillation,
  type ScopeDistillation,
  type ScopeRecord,
} from '@variance-authority/distill';
import {
  declaredSuites,
  decodeTestCoverage,
  isEncodedExecutionIndex,
  RecordWithoutCoverage,
  recordedEyesOf,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { executionIndexOf, recordedExecutionFile } from './execution-input.js';
import { relationsFor } from './source-graph.js';

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
  if (!existsSync(record)) {
    throw new OperatorError(`distill reads a record, and nothing is recorded at ${record}`);
  }
  try {
    // One read: the index and the journals are then one run's, whatever lands between.
    const bytes = await readFile(record);
    const execution = executionIndexOf(bytes);
    if (options.test === undefined && options.file !== undefined) {
      const input = { file: options.file, execution, coverage: coverageOf(bytes, record) };
      const flat = distillFile(input);
      // The graph is read only when there is a load to give a cause: the scan costs more than the record.
      if (!flat.modules?.some(({ entered }) => entered === 0)) return flat;
      const graph = await fileGraph(options.root);
      return distillFile({ ...input, imports: importsOf(graph), republishes: republishesOf(graph) });
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
    if (!existsSync(record)) throw new OperatorError(`distill reads a record, and nothing is recorded at ${record}`);
    const bytes = await readFile(record);
    records.push({
      ...(suite === undefined ? {} : { suite }),
      execution: asOperator(() => executionIndexOf(bytes)),
      coverage: asOperator(() => coverageOf(bytes, record)),
    });
  }
  if (records.length === 0) {
    throw new OperatorError(
      `nothing is recorded in \`${options.root}\`: none of the suites ${unrecorded.join(', ')} left a per-case index. ` +
        'Run a suite with `withTestSelection` and ask again.',
      { kind: 'unrecorded' },
    );
  }
  const input = {
    ...(options.from === undefined ? {} : { within: options.from }),
    records,
    ...(unrecorded.length === 0 ? {} : { unrecorded }),
  };
  const flat = asOperator(() => distillScope(input));
  if (flat.spills.length === 0) return flat;
  const graph = await fileGraph(options.root);
  return distillScope({ ...input, imports: importsOf(graph), republishes: republishesOf(graph) });
}

/** The declared suites' names, or none when the repository records once. */
function suitesOf(root: string): readonly string[] | undefined {
  return asOperator(() => declaredSuites(root))?.map((suite) => suite.name);
}

function asOperator<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

function fileGraph(root: string): Promise<Relations> {
  return relationsFor(root, ['.'], [], [], {
    why: 'a file reading names the import that brought in each module no case entered, from the file graph',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  });
}

/** The edges a runtime evaluates a module through on load: a dynamic import evaluates later, if at all. */
const LOADING = new Set((['imports', 'reexports', 'asset'] as const satisfies readonly EdgeKind[]).map((kind) => EDGE_KINDS.indexOf(kind)));
const FILE = NODE_KINDS.indexOf('file');

/** The files each file imports statically, read from the file graph by the names the record uses. */
function importsOf(relations: Relations): (file: string) => readonly string[] {
  const { offset, target, kind } = relations.depends;
  return (file) => {
    const id = idOf(relations, 'file', file);
    if (id === undefined) return [];
    const found: string[] = [];
    for (let at = offset[id]!; at < offset[id + 1]!; at += 1) {
      if (LOADING.has(kind[at]!) && relations.kinds[target[at]!] === FILE) found.push(relations.names[target[at]!]!);
    }
    return found;
  };
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
