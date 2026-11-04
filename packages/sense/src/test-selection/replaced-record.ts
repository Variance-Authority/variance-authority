/**
 * What a run does with the record it is about to land on, before it lands.
 *
 * A record under other probes can take no run: one build records under one set
 * of probes, and the lay refuses it. Whose the file is decides what follows. The
 * record in the checkout's cache is the tool's own, rebuilt by the next run and
 * read by nobody else, so it is replaced. A path somebody handed in is theirs,
 * and the lay's refusal stands.
 */

// compass: variance-authority.reach

import { rm } from 'node:fs/promises';
import { commitRunsFile } from './commit-runs.js';
import { askCoverageFile } from './coverage-file.js';
import { withIndexLock } from './index-lock.js';
import { ownLayerFile } from './own-layer.js';
import { cachedRecord, noteSeeded, seedTestCoverage } from './record-location.js';

/**
 * Make the record at `file` one a run under the probes `instrumentation` can
 * land on: a cached record under other probes goes, in one printed line, and
 * the checkout's base is laid when it holds none. Does nothing for a `file`
 * outside the cache. `alone`, see `recordsAlone`, lays no base.
 */
export async function prepareRecord(
  file: string,
  root: string,
  instrumentation: string | undefined,
  options: { readonly alone?: boolean; readonly cacheRoot?: string | undefined } = {},
): Promise<void> {
  if (cachedRecord(file, root, options.cacheRoot) === undefined) return;
  const replaced = instrumentation === undefined ? undefined : await replaceForeign(file, instrumentation);
  if (replaced !== undefined) {
    console.warn(
      `variance-authority replaced the record at ${file}: it was written under the probes \`${replaced}\` and this run ` +
        `records under \`${instrumentation}\`, so it could answer nothing for this build.`,
    );
  }
  if (options.alone !== true) noteSeeded(await seedTestCoverage(file, root, instrumentation, options.cacheRoot));
}

/**
 * Delete the record at `file` when it is under other probes than `run`, and
 * return those probes. Asked again under the record's lock, so a worker that
 * finds the lock taken or the record already landed leaves it alone. The record
 * goes last: a crash leaves it to be replaced again, never a record that lost
 * the files beside it. A record this build cannot read is not this question's.
 */
async function replaceForeign(file: string, run: string): Promise<string | undefined> {
  const seen = writtenUnder(file);
  if (seen === undefined || seen === run) return undefined;
  const replaced = await withIndexLock(file, async () => {
    const written = writtenUnder(file);
    if (written === undefined || written === run) return undefined;
    await rm(commitRunsFile(file), { force: true });
    await rm(ownLayerFile(file), { force: true });
    await rm(file, { force: true });
    return written;
  });
  return replaced.held ? replaced.value : undefined;
}

/** The probes of the record at `file`, from its header. Nothing for one that is gone, or that this build cannot read. */
function writtenUnder(file: string): string | undefined {
  try {
    return askCoverageFile(file, (record) => record.instrumentation);
  } catch {
    return undefined;
  }
}
