// compass: variance-authority/runtime/attention
import { readFile } from 'node:fs/promises';
import { readEyesArchive } from '@variance-authority/eyes/archive';
import {
  distill,
  formatDistillation,
  parseExecutionIndex,
  type Distillation,
} from '@variance-authority/distill';
import { OperatorError } from '../exit.js';

export interface DistillOptions {
  readonly test: string;
  readonly eyes?: string;
  readonly execution?: string;
}

/** Read portable observations and produce one test's deterministic distillation. */
export async function distillFiles(options: DistillOptions): Promise<Distillation> {
  if (options.eyes === undefined && options.execution === undefined) {
    throw new OperatorError('distill needs --eyes <path>, --execution <path>, or both');
  }
  try {
    const [eyes, execution] = await Promise.all([
      options.eyes === undefined ? undefined : readEyesArchive(options.eyes),
      options.execution === undefined
        ? undefined
        : readFile(options.execution, 'utf8').then((text) => parseExecutionIndex(JSON.parse(text))),
    ]);
    return distill({
      test: options.test,
      ...(eyes === undefined ? {} : { eyes }),
      ...(execution === undefined ? {} : { execution }),
    });
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError(error instanceof Error ? error.message : String(error));
  }
}

export function formatDistill(result: Distillation, format: 'text' | 'json'): string {
  return format === 'json' ? `${JSON.stringify(result, null, 2)}\n` : `${formatDistillation(result)}\n`;
}
