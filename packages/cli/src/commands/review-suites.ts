// compass: variance-authority/runtime/attention
import { declaredSuites } from '@variance-authority/sense/test-selection';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';

/** A suite that cannot be read remains visible beside the suites that can. */
export interface MissedSuite {
  readonly suite?: string;
  readonly missed: string;
  readonly unrecorded?: true;
}

/**
 * Ask every suite the root config declares, in declaration order, or the one
 * record when it declares none. A suite whose record cannot answer is kept as
 * why; a base the change cannot be diffed from is no one suite's, and fails the
 * whole reading.
 */
export async function eachSuite<T>(root: string, ask: (suite: string | undefined) => Promise<T>): Promise<(T | MissedSuite)[]> {
  const readings: (T | MissedSuite)[] = [];
  for (const suite of declaredSuites(root)?.map((declared) => declared.name) ?? [undefined]) {
    try {
      readings.push(await ask(suite));
    } catch (error) {
      if (error instanceof OperatorError && error.kind === 'undiffed') throw error;
      readings.push({
        ...(suite === undefined ? {} : { suite }),
        missed: messageOf(error),
        ...(error instanceof OperatorError && error.kind === 'unrecorded' ? { unrecorded: true as const } : {}),
      });
    }
  }
  return readings;
}
