/**
 * A record declined for its size, and whether the decline still holds.
 *
 * The native batch builds every record ([`native.ts`](./native.ts)), and
 * `too_large` in `acquire.rs` words a decline. A kept record is reused by its
 * digest, so a scan asks here whether a decline it is about to reuse is still
 * true of the file as it is checked out.
 */

import { stat } from 'node:fs/promises';
import type { FileRecord } from '@variance-authority/core/relate';

/**
 * One megabyte, which is larger than source people write and smaller than
 * output machines generate.
 *
 * Files past a megabyte are bundles; at the cap one costs about a hundred
 * megabytes of arena, at ten times it eight hundred.
 *
 * A record declined at this limit names the bytes it declined and is kept, and
 * a run at the default names no limit in its configuration digest (`configOf`
 * in [`reuse.ts`](./reuse.ts)). So a change to this value bumps `VERSION`
 * there, or every index keeps the records the old limit declined.
 */
export const LARGEST_FILE = 1024 * 1024;

/** The rest of the reason a file declined for its size is given: `too_large` in `acquire.rs` writes the same words. */
const TOO_LARGE =
  'this scan opens: parsing it costs about fifty times that in memory, and it is ' +
  'almost certainly built output. Raise `largestFile` to read it anyway.';

/** Whether `record` was declined for its size. */
// TODO: a record carries a decline for size only in its reason's words; a field
// for it would let a keep ask without matching them.
export function declinedForSize(record: FileRecord): boolean {
  const { file, unknown } = record;
  return unknown !== undefined && unknown.startsWith(`${file} is `) && unknown.endsWith(TOO_LARGE);
}

/**
 * Whether the file at `absolute` is still over `largestFile` as it is checked
 * out, through any link. A decline is decided on these bytes and kept by Git's
 * object name, which under a clean filter — `core.autocrlf`, LFS — names others.
 */
export async function stillTooLarge(absolute: string, largestFile: number): Promise<boolean> {
  const size = await sized(absolute);
  return size !== undefined && size > largestFile;
}

async function sized(absolute: string): Promise<number | undefined> {
  try {
    return (await stat(absolute)).size;
  } catch {
    return undefined;
  }
}
