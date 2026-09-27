import { canonicalize, type CanonicalValue } from './canonical.js';
import { sha256Hex, sha256HexBytes } from './sha256.js';

/**
 * Content addressing (Principle 4).
 *
 * Hashes are the system's only identity. A baseline is addressed by what it *is*,
 * never by the branch or commit it arrived on, which is why a rebase cannot
 * invalidate one.
 *
 * Digests are prefixed with their algorithm and truncated to 128 bits. The prefix
 * makes a future algorithm change a visible, greppable migration rather than a
 * silent collision domain; 128 bits is far beyond collision risk for a corpus
 * bounded by the number of subjects a repository has, and keeps `variance.lock`
 * readable as a diff — a manifest a human refuses to read is a manifest nobody
 * reviews.
 */
export type Digest = string;

const PREFIX = 'v1';
const HEX_LENGTH = 32;

/**
 * Hash an already-canonical string.
 *
 * Synchronous, and must stay so. `propsDigest` runs inside the rendering page,
 * where a prop may be a function or an element that cannot be serialized out —
 * so the digest is taken where the value still exists. `crypto.subtle` is async
 * and would colour the whole normalizer; see `sha256.ts`.
 */
export function digestString(input: string): Digest {
  return `${PREFIX}:${sha256Hex(input).slice(0, HEX_LENGTH)}`;
}

/**
 * The digest of a SHA-256 some other implementation already computed.
 *
 * The algorithm in `sha256.ts` is portable TypeScript because `core` has to run
 * inside the page. A host that is not a page — a transform, a scanner, anything
 * reading files off a disk — has the same hash natively and an order of
 * magnitude faster, and FIPS 180-4 leaves no room for the two to disagree.
 *
 * What such a host must not also own is the shape. The prefix is what makes an
 * algorithm change a greppable migration, and the truncation is what keeps a
 * manifest readable; a second place deciding either is a digest domain that
 * splits without anybody noticing. So the host brings the hex and this brings
 * the identity.
 */
export function digestOfSha256(hex: string): Digest {
  return `${PREFIX}:${hex.slice(0, HEX_LENGTH)}`;
}

/**
 * Hash raw bytes — an image, a font file, anything whose identity is its octets.
 *
 * Same prefix and same truncation as every other digest here, so an asset hash
 * and a render hash are the same kind of value and neither can be mistaken for
 * the other's domain. What it is for is `EnvironmentInputs.assets`: a URL is not
 * an identity, and the same `url(...)` can resolve to different bytes tomorrow.
 */
export function digestBytes(bytes: Uint8Array): Digest {
  return `${PREFIX}:${sha256HexBytes(bytes).slice(0, HEX_LENGTH)}`;
}

/** Canonicalize then hash. The only correct way to hash a structure. */
export function digestValue(value: CanonicalValue): Digest {
  return digestString(canonicalize(value));
}

/**
 * Combine digests under a domain label.
 *
 * The label prevents cross-domain collision: an environment key and a render hash
 * built from identical component digests must not be equal, or an environment
 * change could masquerade as a content match.
 */
export function digestCombine(domain: string, parts: readonly Digest[]): Digest {
  return digestString(`${domain}\u0000${parts.join('\u0000')}`);
}

/**
 * How much of an encoded id a filename may carry.
 *
 * A filename is capped at 255 bytes on every filesystem anybody runs a suite on,
 * and a caller's own suffix -- an extension, a temporary marker with a pid and a
 * UUID in it -- comes out of the same 255. What is left is the budget.
 */
const NAME_BUDGET = 140;

/**
 * A filesystem name for an id that was not written with filesystems in mind.
 *
 * An id long enough to overrun a filename is not an exotic case: a suite that
 * names subjects after the test that produced them -- a file path and a full
 * test name -- passes 255 bytes on ordinary tests, and the whole point of that
 * convention is that the id says where the subject came from. Truncating alone
 * would put two tests in one file, so a long id keeps a readable prefix and
 * earns a digest of the whole id, which is what actually distinguishes it.
 */
export function fileNameFor(id: string): string {
  const encoded = encodeURIComponent(id);
  if (encoded.length <= NAME_BUDGET) return encoded;
  return `${encoded.slice(0, NAME_BUDGET)}~${digestFileName(digestString(id))}`;
}

/**
 * A digest spelled so that a filesystem accepts it: `v1-<hex>` for `v1:<hex>`.
 *
 * The colon is the one character in a digest that is not portable. NTFS refuses
 * it in a name, so a directory named by a raw digest is a repository that cannot
 * be checked out on Windows, and `actions/upload-artifact` refuses the path for
 * the same reason. Every name made from a digest goes through here, so the
 * spelling has one owner and {@link digestOfFileName} can read it back.
 */
export function digestFileName(digest: Digest): string {
  return digest.replace(':', '-');
}

const FILE_NAME = new RegExp(`^${PREFIX}[-:]([0-9a-f]{${HEX_LENGTH}})$`);

/**
 * The digest a name spells, or `undefined` because it spells none.
 *
 * Reads the raw `v1:<hex>` spelling as well as {@link digestFileName}'s. The
 * file-backed store named its identity partitions with the raw digest before
 * this spelling existed, and a baseline kept under that name is still a
 * baseline: a reader that knew only the new spelling would call it `new` and
 * record over it.
 */
export function digestOfFileName(name: string): Digest | undefined {
  const hex = FILE_NAME.exec(name)?.[1];
  return hex === undefined ? undefined : `${PREFIX}:${hex}`;
}
