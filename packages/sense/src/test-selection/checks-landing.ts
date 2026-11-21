/**
 * A run's checks, laid when the run staged nothing else to land: the record then
 * says this run's scope and checks, never the run's before it.
 */

// compass: variance-authority.reach

import { resolve } from 'node:path';
import { landedChecks, type ChecksSection } from './checks-record.js';
import { commitOf } from './commit.js';
import { landChecks } from './commit-runs.js';
import { withIndexLock } from './index-lock.js';
import type { RecordExecutionOptions } from './journal.js';
import { recordFileFor } from './record-location.js';
import { prepareRecord } from './replaced-record.js';

/**
 * Lay `checks` over the record the run would have landed in, under the same
 * lock as `recordExecution`. A checkout with no record yet gets its base first,
 * as a run's first landing does, so the checks never stand where the base
 * should have been laid.
 */
export async function recordChecks(
  options: Pick<RecordExecutionOptions, 'root' | 'coverageFile' | 'suite' | 'cacheRoot'>,
  checks: ChecksSection,
): Promise<void> {
  const root = resolve(options.root);
  const coverageFile = recordFileFor(root, root, options);
  const laid = landedChecks(checks, await commitOf(root));
  await withIndexLock(coverageFile, async (lock) => {
    await prepareRecord(lock, root, undefined, { cacheRoot: options.cacheRoot });
    await landChecks(coverageFile, laid);
  });
}
