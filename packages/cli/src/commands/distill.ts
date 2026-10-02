// compass: variance-authority/runtime/attention
import { readEyesArchive } from '@variance-authority/eyes/archive';
import {
  distill,
  formatDistillation,
  type Distillation,
} from '@variance-authority/distill';
import { OperatorError } from '../exit.js';
import { readExecutionIndex, recordedExecutionFile } from './execution-input.js';

export interface DistillOptions {
  readonly test: string;
  readonly eyes?: string;
  /** Absent, the index a recorded run left beside the record is read. */
  readonly execution?: string;
  /** The one declared suite whose recorded index is read. */
  readonly suite?: string;
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
  const from = options.execution ?? (await recorded(options));
  try {
    const [eyes, execution] = await Promise.all([
      options.eyes === undefined ? undefined : readEyesArchive(options.eyes),
      from === undefined ? undefined : readExecutionIndex(from),
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

/**
 * The index a recorded run left, or none when nothing is recorded and an Eyes
 * archive can still be read alone. With neither, the refusal says where the
 * index was looked for.
 */
async function recorded(options: DistillOptions): Promise<string | undefined> {
  try {
    return await recordedExecutionFile(options.root ?? process.cwd(), options.suite);
  } catch (error) {
    if (options.eyes !== undefined && error instanceof OperatorError && error.kind === 'unrecorded') return undefined;
    throw error;
  }
}

export function formatDistill(result: Distillation, format: 'text' | 'json'): string {
  return format === 'json' ? `${JSON.stringify(result, null, 2)}\n` : `${formatDistillation(result)}\n`;
}
