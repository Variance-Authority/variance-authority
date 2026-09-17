// compass: variance-authority.retention

import { RasterStoreError, REFUSAL, messageOf } from '@variance-authority/raster';

/**
 * The one read failure a file-backed store is allowed to treat as an answer.
 *
 * Shared by every module that touches the baseline directories, so that the
 * distinction between *not there* and *could not be established* is made in one
 * place rather than re-decided at each `readdir`.
 */

/**
 * `null` for ENOENT, and for nothing else.
 *
 * The one errno that answers the question rather than failing to. Every other
 * one — a permission, a descriptor, an I/O error on a network mount — means this
 * process could not establish what is on disk, which is not the same fact and
 * must not be reported as it.
 */
export async function orAbsent<T>(read: () => Promise<T>, path: string): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (isMissing(error)) return null;
    throw new RasterStoreError(
      `the baseline store could not read ${path}: ${messageOf(error)}. ${REFUSAL}.`,
      { cause: error },
    );
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}
