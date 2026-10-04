// compass: variance-authority/runtime/attention
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseEyesJournal } from '@variance-authority/eyes/archive';
import {
  distill,
  distillFile,
  formatDistillation,
  formatFileDistillation,
  type Distillation,
  type EyesAttempt,
  type FileDistillation,
} from '@variance-authority/distill';
import {
  decodeTestCoverage,
  recordedEyesOf,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { executionIndexOf, recordedExecutionFile } from './execution-input.js';

export interface DistillOptions {
  /** The case's id, its exact title, or a part of the title. */
  readonly test?: string;
  /** A part of the test file's path, which narrows `test`; alone, the file to read. */
  readonly file?: string;
  /** The record to read; when unnamed, the one a reader of the checkout reads. */
  readonly execution?: string;
  /** The one declared suite whose record is read. */
  readonly suite?: string;
  /** The checkout whose record is read, and the root the record's paths are relative to. */
  readonly root: string;
}

/**
 * Read one case, or with `file` alone one test file, out of a record and
 * produce its deterministic distillation.
 *
 * The record holds the case index and, when the run opted into Eyes, every
 * attempt's journal. A record named with `--execution` may also be a case
 * index on its own, which has no journals to read, and no coverage rows to
 * say what a test file loaded.
 */
export async function distillFiles(options: DistillOptions): Promise<Distillation | FileDistillation> {
  const record = options.execution ?? (await recordedExecutionFile(options.root, options.suite));
  if (!existsSync(record)) {
    throw new OperatorError(`distill reads a record, and nothing is recorded at ${record}`);
  }
  try {
    // One read: the index and the journals are then one run's, whatever lands between.
    const bytes = await readFile(record);
    const execution = executionIndexOf(bytes);
    if (options.test === undefined && options.file !== undefined) {
      return distillFile({ file: options.file, execution, coverage: coverageOf(bytes, record) });
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
 * The coverage rows of a record, which say which test file loaded which module.
 * A case index on its own carries none, and a file reading has nothing to read.
 */
function coverageOf(bytes: Uint8Array, record: string): TestCoverage {
  try {
    return decodeTestCoverage(bytes);
  } catch {
    throw new OperatorError(
      `${record} holds no coverage rows, which say what a test file loaded; name a case with --test, or read a record`,
    );
  }
}

function journalsOf(journals: NonNullable<ReturnType<typeof recordedEyesOf>>['journals']): readonly EyesAttempt[] {
  return journals.map((row) => ({
    case: row.case,
    attempt: row.attempt,
    journal: parseEyesJournal(row.journal, `the Eyes journal of ${row.case}, attempt ${row.attempt}`),
  }));
}

export function formatDistill(result: Distillation | FileDistillation, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(result, null, 2)}\n`;
  return `${'test' in result ? formatDistillation(result) : formatFileDistillation(result)}\n`;
}
