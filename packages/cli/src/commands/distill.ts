// compass: variance-authority/runtime/attention
import { readEyesArchive } from '@variance-authority/eyes/archive';
import {
  distill,
  formatDistillation,
  type Distillation,
} from '@variance-authority/distill';
import { OperatorError } from '../exit.js';
import { readExecutionIndex } from './execution-input.js';

export interface DistillOptions {
  readonly test: string;
  readonly eyes?: string;
  readonly execution?: string;
  /**
   * The project root both producers recorded against.
   *
   * Eyes names a component's source with an absolute path and Sense names an
   * entered module relative to the project root, so the two are compared
   * against this. When it is wrong the reading says so rather than reporting
   * every entered file as an opportunity.
   */
  readonly root?: string;
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
        : readExecutionIndex(options.execution),
    ]);
    return distill({
      test: options.test,
      ...(options.root === undefined ? {} : { root: options.root }),
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
