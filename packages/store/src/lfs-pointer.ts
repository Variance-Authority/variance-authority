// compass: variance-authority.retention

import type { Raster } from '@variance-authority/core/format';
import { RasterStoreError, REFUSAL } from '@variance-authority/raster';

/** First bytes of an LFS pointer file, per the git-lfs v1 pointer spec. */
const POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';

/** How many leading bytes {@link isLfsPointer} needs to answer. */
export const LFS_POINTER_HEAD_BYTES = POINTER_PREFIX.length;

/**
 * Whether a file's first bytes are a git-LFS pointer rather than the file.
 *
 * Exported so that the signature this store refuses is the one `variance doctor`
 * looks for: two copies of a prefix are two chances for doctor to call a store
 * fine that the run then refuses.
 */
export function isLfsPointer(head: Uint8Array): boolean {
  return Buffer.from(head.subarray(0, POINTER_PREFIX.length)).toString('utf8') === POINTER_PREFIX;
}

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

  throw new RasterStoreError(
    `${what} is a git-LFS pointer, not an image. The file was checked out without ` +
      'git-lfs installed, so the working tree holds the pointer text where the PNG ' +
      `should be. Run \`git lfs install --local\`, and \`git lfs pull\` to fetch every image, or ` +
      `drop \`verify: false\` to fetch only the images the run compares. ${REFUSAL}.`,
  );
}
