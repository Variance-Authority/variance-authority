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

import { closeSync, openSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { commitRunsFile } from './commit-runs.js';
import { descriptor } from './coverage-file.js';
import { foreignProbes } from './format-layer.js';
import { withIndexLock } from './index-lock.js';
import { ownLayerFile } from './own-layer.js';
import { cachedRecord, noteSeeded, seedTestCoverage } from './record-location.js';

/**
 * Make the record at `file` one a run under the probes `instrumentation` can
 * land on: a cached record under other probes goes, in one printed line, and
 * the checkout's base is laid when it holds none. Does nothing for a `file`
 * outside the cache. A run that lays no coverage passes no probes (`laidProbes`)
 * and replaces nothing. `alone`, see `recordsAlone`, lays no base.
 */
export async function prepareRecord(
  file: string,
  root: string,
  instrumentation: string | undefined,
  options: { readonly alone?: boolean; readonly cacheRoot?: string | undefined } = {},
): Promise<void> {
  if (cachedRecord(file, root, options.cacheRoot) === undefined) return;
  const replaced = await replaceForeign(file, instrumentation);
  if (replaced !== undefined) {
    console.warn(
      `variance-authority replaced the record at ${file}: it was written under the probes \`${replaced}\` and this run ` +
        `records under \`${instrumentation}\`, so this run cannot be laid over it.`,
    );
  }
  if (options.alone !== true) noteSeeded(await seedTestCoverage(file, root, instrumentation, options.cacheRoot));
}

/**
 * Delete the record at `file` when it is foreign to `run`, and return its
 * probes. Asked again under the record's lock, so a worker that finds the lock
 * taken or the record already landed leaves it alone. The record goes last: a
 * crash leaves it to be replaced again, never a record that lost the files
 * beside it.
 */
async function replaceForeign(file: string, run: string | undefined): Promise<string | undefined> {
  if (foreignAt(file, run) === undefined) return undefined;
  const replaced = await withIndexLock(file, async () => {
    const written = foreignAt(file, run);
    if (written === undefined) return undefined;
    await rm(commitRunsFile(file), { force: true });
    await rm(ownLayerFile(file), { force: true });
    await rm(file, { force: true });
    return written;
  });
  return replaced.held ? replaced.value : undefined;
}

/** {@link foreignProbes} of the record at `file`, read from its header. Nothing for one that is gone. */
function foreignAt(file: string, run: string | undefined): string | undefined {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return undefined;
  }
  try {
    return foreignProbes(descriptor(fd), run);
  } finally {
    closeSync(fd);
  }
}
