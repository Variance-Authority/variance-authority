/** First bytes of an LFS pointer file, per the git-lfs v1 pointer spec. */
const POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';

/** How many leading bytes {@link isLfsPointer} needs to answer. */
export const LFS_POINTER_HEAD_BYTES = POINTER_PREFIX.length;

/**
 * Whether a file's first bytes are a git-LFS pointer rather than the file.
 *
 * One signature for every reader: the store refusing a baseline, `variance
 * doctor` looking for the files the store would refuse, and the source index
 * refusing a source text git handed back as a pointer. Two copies of a prefix are
 * two chances for one reader to call a file fine that another refuses. The
 * native addon holds the one copy a second language forces, in `lfs.rs`.
 */
export function isLfsPointer(head: Uint8Array): boolean {
  if (head.length < POINTER_PREFIX.length) return false;
  for (let at = 0; at < POINTER_PREFIX.length; at += 1) {
    if (head[at] !== POINTER_PREFIX.charCodeAt(at)) return false;
  }
  return true;
}
