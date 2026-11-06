// compass: variance-authority.retention

import { posix } from 'node:path';
import { digestFileName, digestOfFileName, fileNameFor, type Digest } from '@variance-authority/core/format';
import type { BaselineKey } from '@variance-authority/raster';

/**
 * Where the layout before `baselines.path` kept a baseline, so an upgrade reads
 * it as the baseline it is.
 *
 * That layout put the renderer's identity digest in the path —
 * `<holder>/v1-<hex>/<leaf>` — under one of two holders: the root (`flat`), or
 * the subject's own directory (`beside`). Nothing writes it any more. A
 * repository that committed baselines under it still holds them, and a lookup
 * that stopped at the template path would call every one of them `new` and
 * record over it, which is a baseline lost and reported as success.
 *
 * Every function here answers *which path*, and none reads or writes one
 * ([ADR-0016](https://github.com/Variance-Authority/variance-authority/blob/main/docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)).
 * The paths are computed from the key, never decoded from what is on disk: a
 * leaf the old layout truncated and digested is found by computing the same
 * truncation.
 */

/**
 * The identity a partition directory is named for, or `undefined` for any
 * other directory. Both spellings answer: `v1-<hex>`, which the layout wrote,
 * and the raw digest, which it wrote before that and still read.
 */
export function identityOfPartition(name: string): Digest | undefined {
  return digestOfFileName(name);
}

/** The two names a partition for this identity may have, the later spelling first. */
export function partitionsOf(identity: Digest): readonly [written: string, raw: string] {
  return [digestFileName(identity), identity];
}

/** A directory that may hold partitions, and the file name this key had inside each. */
export interface LegacyHolder {
  /** Under the root, posix, `''` for the root itself. */
  readonly holder: string;
  /** The file name inside a partition, without an extension. */
  readonly leaf: string;
}

/**
 * Every place the old layout could have put this key, without duplicates.
 *
 * Three, because which one a repository used was a config value the new config
 * no longer has: `flat` at the root with the whole id as the leaf; `beside` in
 * the declaring file's directory with the whole id; and `beside` in the id's own
 * directories with its last segment, for a subject no file declared. A key that
 * cannot name a holder — no file, or an id that is not a relative path — names
 * fewer, never a wrong one.
 */
export function legacyHolders(key: BaselineKey): readonly LegacyHolder[] {
  const labelled = (name: string): string => fileNameFor(key.label === undefined ? name : `${name}__${key.label}`);
  const whole = labelled(key.subject);
  const found: LegacyHolder[] = [{ holder: '', leaf: whole }];
  const directory = key.file === undefined ? undefined : relativeDirectory(posix.dirname(key.file));
  if (directory !== undefined) found.push({ holder: directory, leaf: whole });
  const parts = key.subject.split('/');
  if (relativeDirectory(key.subject) !== undefined) {
    found.push({ holder: parts.slice(0, -1).join('/'), leaf: labelled(parts.at(-1)!) });
  }
  const seen = new Set<string>();
  return found.filter((place) => {
    const at = `${place.holder}/${place.leaf}`;
    if (seen.has(at)) return false;
    seen.add(at);
    return true;
  });
}

/** A posix path with no way out of the root, `''` for the root, or `undefined`. */
function relativeDirectory(path: string): string | undefined {
  if (path === '.' || path === '') return '';
  if (path.startsWith('/') || path.includes('\\')) return undefined;
  const parts = path.split('/');
  return parts.some((part) => part === '' || part === '.' || part === '..') ? undefined : path;
}
