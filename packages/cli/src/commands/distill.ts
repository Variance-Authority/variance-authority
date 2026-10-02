// compass: variance-authority/runtime/attention
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseEyesJournal } from '@variance-authority/eyes/archive';
import {
  distill,
  formatDistillation,
  type Distillation,
  type EyesAttempt,
} from '@variance-authority/distill';
import { recordedEyesOf, testCoverageFile } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { executionIndexOf } from './execution-input.js';

export interface DistillOptions {
  readonly test: string;
  /** The record to read; the checkout's own, `testCoverageFile(root)`, when unnamed. */
  readonly execution?: string;
  /** The checkout whose record is read, and the root the record's paths are relative to. */
  readonly root: string;
}

/**
 * Read one case out of a record and produce its deterministic distillation.
 *
 * The record holds the case index and, when the run opted into Eyes, every
 * attempt's journal. A record named with `--execution` may also be a case
 * index on its own, which has no journals to read.
 */
export async function distillFiles(options: DistillOptions): Promise<Distillation> {
  const record = options.execution ?? testCoverageFile(options.root);
  if (!existsSync(record)) {
    throw new OperatorError(`distill reads a record, and nothing is recorded at ${record}`);
  }
  try {
    // One read: the index and the journals are then one run's, whatever lands between.
    const bytes = await readFile(record);
    const execution = executionIndexOf(bytes);
    const section = recordedEyesOf(bytes);
    return distill({
      test: options.test,
      root: options.root,
      execution,
      ...(section === undefined ? {} : { eyes: journalsOf(section.journals), watched: section.watched }),
    });
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError(error instanceof Error ? error.message : String(error));
  }
}

function journalsOf(journals: NonNullable<ReturnType<typeof recordedEyesOf>>['journals']): readonly EyesAttempt[] {
  return journals.map((row) => ({
    case: row.case,
    attempt: row.attempt,
    journal: parseEyesJournal(row.journal, `the Eyes journal of ${row.case}, attempt ${row.attempt}`),
  }));
}

export function formatDistill(result: Distillation, format: 'text' | 'json'): string {
  return format === 'json' ? `${JSON.stringify(result, null, 2)}\n` : `${formatDistillation(result)}\n`;
}
