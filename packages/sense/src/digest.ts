import { createHash } from 'node:crypto';
import { digestOfSha256, type Digest } from '@variance-authority/core/format';

export type { Digest } from '@variance-authority/core/format';

/**
 * The digests this package takes, from the platform's SHA-256 rather than the
 * portable one.
 *
 * `core` implements SHA-256 by hand because `propsDigest` runs inside the
 * rendering page, where `node:crypto` does not exist and `crypto.subtle` is
 * async (`packages/core/src/format/sha256.ts`). Nothing here runs in a page.
 * `sense` reads files, parses them, and writes records; every digest it takes is
 * taken in a Node process that already has the same algorithm compiled in, and
 * the difference is not a rounding error — the portable implementation moves
 * about 69 MB/s against `node:crypto`'s 905.
 *
 * That matters because of what is being hashed. Instrumentation digests every
 * module's source and every block's text, so a first pass over a two hundred
 * thousand file checkout hashes the whole checkout; at portable speed that is
 * about forty per cent of the pass. The output is identical either way — FIPS
 * 180-4 admits one answer — and `digest.test.ts` is what says so rather than
 * this paragraph.
 */

/** A string's digest, in the shape every other digest in the system has. */
export function digestString(input: string): Digest {
  return digestOfSha256(createHash('sha256').update(input, 'utf8').digest('hex'));
}

/** Raw bytes' digest — a stored segment, an asset, anything whose identity is its octets. */
export function digestBytes(bytes: Uint8Array): Digest {
  return digestOfSha256(createHash('sha256').update(bytes).digest('hex'));
}
