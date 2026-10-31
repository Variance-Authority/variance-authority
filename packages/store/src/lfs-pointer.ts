// compass: variance-authority.retention

import { isLfsPointer, LFS_POINTER_HEAD_BYTES } from '@variance-authority/core';
import type { Raster } from '@variance-authority/core/format';
import { RasterStoreError, REFUSAL } from '@variance-authority/raster';

/** What the reader is told to do about a pointer, for an image and a record alike. */
const FETCH =
  'Run `git lfs install --local`, and `git lfs pull` to fetch every file, or ' +
  'drop `verify: false` to fetch only the images the run compares';

/**
 * An unsmudged pointer is a failure, never an image and never a miss.
 *
 * On a clone without git-lfs the file at the baseline's path is 130 bytes of
 * text. Handing it back would produce a comparison between a PNG and a pointer —
 * at best a decode error blamed on the renderer, at worst a subject reported as
 * entirely changed. Reporting it as *absent* would be worse still: `new`
 * re-records whatever is on screen and destroys the baseline it was supposed to
 * compare against, which is the same failure the remote store refuses.
 *
 * A {@link RasterStoreError} rather than a plain one, because the fault is in the
 * checkout and not in the subject. `run` routes that type to the operator exit and
 * takes any other throw as being about the component it was observing, so a plain
 * error reports every subject that reaches this method as `failed` and exits 1 —
 * a verdict on code nobody has touched, where a checkout that cannot be read is exit 2. Not every
 * subject on the clone: `describe` settles the ones whose document did not move
 * without ever looking a raster up, which is the cost `createLfsStore` admits.
 *
 * Only the pointer signature is rejected. Anything else is passed through
 * untouched, so this store does not quietly acquire a stricter idea of what a
 * raster may contain than the store it delegates to.
 */
export function refuseAPointer(raster: Raster, what: string): void {
  // 60 base64 characters decode to 45 bytes, which covers the signature. Decoding
  // the whole image to read its first line would cost a megabyte per lookup.
  // A record with no image cannot be a pointer: there is no file for git-lfs to
  // have left behind.
  if (raster.bytes === undefined) return;
  if (!isLfsPointer(Buffer.from(raster.bytes.slice(0, 60), 'base64'))) return;

  throw refused(what, 'an image', 'the image');
}

/**
 * Image bytes that are a pointer, refused as one by the read that holds them.
 * The format check on a read would otherwise call them a mislabelled image.
 */
export function refuseAPointerImage(bytes: Uint8Array, what: string): void {
  if (isLfsPointer(bytes.subarray(0, LFS_POINTER_HEAD_BYTES))) throw refused(what, 'an image', 'the image');
}

/**
 * A baseline record that is a pointer, refused as one.
 *
 * Where `.gitattributes` sends a store's `.json` files to LFS as well as its
 * images, a clone without git-lfs holds pointer text where the record should be.
 * Parsed, it is "not readable JSON", which blames a truncated write; swallowed, it
 * is a record that names nobody, and an accept writes plain text over a path LFS
 * tracks. Neither is what happened, so the pointer is named.
 */
export function refuseAPointerRecord(text: string, path: string): void {
  if (!isLfsPointer(new TextEncoder().encode(text.slice(0, 64)))) return;

  throw refused(path, 'a baseline record', 'the record');
}

/** Why `what`, a pointer where `kind` should be, is refused, and how to fetch it. */
function refused(what: string, kind: string, where: string): RasterStoreError {
  return new RasterStoreError(
    `${what} is a git-LFS pointer, not ${kind}. The file was checked out without ` +
      `git-lfs installed, so the working tree holds the pointer text where ${where} ` +
      `should be. ${FETCH}. ${REFUSAL}.`,
  );
}
