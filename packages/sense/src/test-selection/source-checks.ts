/**
 * A run's checks section, with what each case declares read from its test
 * file. The read is the addon's; the judging is `checksOf`'s.
 */

// compass: variance-authority.reach

import { native } from '../addon.js';
import { checksOf, type RanCase } from './case-checks.js';
import type { ChecksSection } from './checks-record.js';

/**
 * The checks section of a run that ran `cases` under `root`, or `undefined`
 * where `checksOf` keeps none or the addon that reads the declarations is not
 * loaded: such a run kept no checks, which is not a run that missed none.
 *
 * A test file is read as the journeys walk reads it: one checked out as a
 * git-LFS pointer, or that the system will not read, throws with its reason.
 */
export function checksOfSource(root: string, cases: readonly RanCase[]): ChecksSection | undefined {
  const declared = native()?.declaredChecks?.(root, cases.map(({ file, name }) => ({ file, name })));
  return declared === undefined ? undefined : checksOf(cases, declared);
}
