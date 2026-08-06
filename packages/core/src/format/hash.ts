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
