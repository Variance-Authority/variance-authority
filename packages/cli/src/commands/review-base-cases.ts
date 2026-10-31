// compass: variance-authority/runtime/attention
/**
 * The cases a review compares the change with, and the case names a test file
 * gained or lost against them.
 */

import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { readExecutionIndex, replacedCases } from './execution-input.js';
import type { MainlineRecord } from './mainline-base.js';
import type { ReviewFile } from './review.js';

/**
 * The case index the change is compared with: the one `--against` names or
 * the mainline published, or the cases the latest run replaced. Absent when
 * none was named and the run replaced none.
 */
export async function baseIndex(
  against: string | undefined,
  from: string,
  mainline: MainlineRecord | undefined,
): Promise<ExecutionIndex | undefined> {
  if (against === undefined) return replacedCases(from);
  try {
    return await readExecutionIndex(against);
  } catch (error) {
    const named = mainline === undefined
      ? `\`--against ${against}\``
      : `the cases mainline ${mainline.mainline} published with its record of "${mainline.suite}", kept at ${against},`;
    throw new OperatorError(`${named} could not be read (${error instanceof Error ? error.message : String(error)}).`);
  }
}

/**
 * Case names a test file declares now and did not before, and the reverse.
 *
 * Only for a file the base holds cases for, or a file the change created. A
 * file the base never ran is not a file whose every case is new.
 */
export function casesMoved(
  file: string,
  held: ExecutionIndex | undefined,
  now: ExecutionIndex,
  created: boolean,
): ReviewFile['cases'] | undefined {
  const after = new Set(now.tests.filter((test) => test.file === file).map((test) => test.name));
  const before = new Set(held?.tests.filter((test) => test.file === file).map((test) => test.name) ?? []);
  if (before.size === 0 && !created) return undefined;
  if (before.size === 0 && after.size === 0) return undefined;
  return {
    added: [...after].filter((name) => !before.has(name)).sort(),
    removed: [...before].filter((name) => !after.has(name)).sort(),
  };
}
