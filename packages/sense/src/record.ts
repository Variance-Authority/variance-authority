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
