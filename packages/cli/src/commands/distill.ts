// compass: variance-authority/runtime/attention
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Relations } from '@variance-authority/core/relate';
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
  importReferences,
  isEncodedExecutionIndex,
  RecordWithoutCoverage,
  recordedEyesOf,
} from '@variance-authority/sense/test-selection';
import { mayMock, shadowReach } from '@variance-authority/sense/taint';
import { messageOf } from '../config-values.js';
import { checkoutFile } from '../checkout-file.js';
import { OperatorError } from '../exit.js';
import { jsonPieces } from '../json-pieces.js';
import { executionIndexOf, recordedExecutionFile } from './execution-input.js';
import { relationsFor } from './source-graph.js';
import { asOperator, nothingRecorded } from './suite-record.js';

export interface DistillOptions {
  /** The case's id, or its whole title. */
  readonly test?: string;
  /**
   * The test file's path, from `root` or from the file system's root, which
   * narrows `test`; alone, the file to read. It names that file only, and one
   * outside `root` is refused.
   */
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
  const file = options.file === undefined ? undefined : checkoutFile(options.root, options.file);
  const record = options.execution ?? (await recordedExecutionFile(options.root, options.suite));
  // One read: the index and the journals are then one run's, whatever lands between.
  const bytes = await recordAt(record);
  try {
    if (options.test === undefined && file !== undefined) {
      // The addon reads the record's cases and the regions a charge asks; no region of the case index is decoded but those.
      const input = { file, record: coverageOf(bytes, record) };
      const flat = readingOf([record], () => distillFile(input));
      // The graph is read only when there is a load to give a cause, or a mock to hold against it: the scan costs more than the record.
      if (!flat.modules?.some(({ entered }) => entered === 0) && !(await mocksIn(options.root, flat.file))) return flat;
      const graph = await fileGraph(options.root);
      return distillFile({
        ...input,
        relations: graph,
        references: (file) => importReferences(options.root, graph, file),
        shadows: (file) => shadowReach(graph, file),
      });
    }
    const execution = executionIndexOf(bytes);
    const section = recordedEyesOf(bytes);
    return distill({
      ...(options.test === undefined ? {} : { test: options.test }),
      ...(file === undefined ? {} : { file }),
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
  const { input, paths } = await scopeOf(options);
  const flat = readingOf(paths, () => distillScope(input));
  if (flat.spills.length === 0) return flat;
  const graph = await fileGraph(options.root);
  return distillScope({ ...input, relations: graph });
}

/**
 * A scope read across records as {@link distillFiles} reads it with no case and
 * no file named, one row a test file, each made as it is reached; the suites
 * that kept no record are named beside the rows. No row names an import, so
 * the file graph is not read. A scope that cannot be read is refused here,
 * before the first row.
 */
export async function distillRows(options: Omit<DistillOptions, 'test' | 'file'>): Promise<{
  readonly rows: Iterable<ScopeRow>;
  readonly unrecorded?: readonly string[];
}> {
  const { input, paths } = await scopeOf(options);
  const rows = readingOf(paths, () => scopeRows(input));
  return { rows, ...(input.unrecorded === undefined ? {} : { unrecorded: input.unrecorded }) };
}

/** The records a scope is read from, where each is, and the declared suites that kept none. */
async function scopeOf(options: Omit<DistillOptions, 'test' | 'file'>): Promise<{ readonly input: ScopeDistillInput; readonly paths: readonly string[] }> {
  const named = options.execution !== undefined || options.suite !== undefined;
  const declared = named ? undefined : suitesOf(options.root);
  const records: ScopeRecord[] = [];
  const paths: string[] = [];
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
    records.push({ ...(suite === undefined ? {} : { suite }), record: coverageOf(bytes, record) });
    paths.push(record);
  }
  if (records.length === 0) throw nothingRecorded(options.root, unrecorded);
  return {
    input: {
      ...(options.from === undefined ? {} : { within: options.from }),
      records,
      ...(unrecorded.length === 0 ? {} : { unrecorded }),
    },
    paths,
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

/**
 * A record that may hold coverage rows, which say which test file loaded which
 * module. A case index written as JSON carries none, and a file reading has
 * nothing to read. Whether a binary record holds them is its header's to say,
 * and the reading opens that header once: see {@link readingOf}.
 */
function coverageOf(bytes: Uint8Array, record: string): Uint8Array {
  if (!isEncodedExecutionIndex(bytes)) throw withoutCoverage([record]);
  return bytes;
}

/**
 * A reading of the records at `paths`, refused as the operator's when one of
 * them holds cases and no coverage rows; a record whose rows do not read is
 * damaged, and the reading says so.
 */
function readingOf<T>(paths: readonly string[], read: () => T): T {
  return asOperator(() => {
    try {
      return read();
    } catch (error) {
      throw error instanceof RecordWithoutCoverage ? withoutCoverage(paths) : error;
    }
  });
}

function withoutCoverage(paths: readonly string[]): OperatorError {
  return new OperatorError(
    `${paths.join(' or ')} holds no coverage rows, which say what a test file loaded; name a case with --test, or read a record`,
  );
}

function journalsOf(journals: NonNullable<ReturnType<typeof recordedEyesOf>>['journals']): readonly EyesAttempt[] {
  return journals.map((row) => ({
    case: row.case,
    attempt: row.attempt,
    journal: parseEyesJournal(row.journal, `the Eyes journal of ${row.case}, attempt ${row.attempt}`),
  }));
}

/** A distillation's text, in the pieces {@link writePieces} writes as they come. */
export function* distillPieces(
  result: Distillation | FileDistillation | ScopeDistillation,
  format: 'text' | 'json',
): Generator<string, void, undefined> {
  if (format === 'json') yield* jsonPieces(result);
  else if ('test' in result) yield formatDistillation(result);
  else yield 'spills' in result ? formatScopeDistillation(result) : formatFileDistillation(result);
  yield '\n';
}
