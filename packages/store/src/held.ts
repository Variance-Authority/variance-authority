// compass: variance-authority.retention

import { readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { Digest } from '@variance-authority/core/format';
import { orAbsent } from './absent.js';
import { identityOfPartition } from './placement.js';

/**
 * What a file-backed store holds and the plan did not name (ADR-0063).
 *
 * Split from `durable.ts` for `placement.ts`'s reason: nothing here decides a
 * verdict. It is a directory walk and a naming rule, and the one thing it is
 * allowed to be wrong about — a name it could not decode — it reports as the
 * characters that are actually on disk.
 */

/**
 * The names this identity holds under the root, less the paths already planned.
 */
export async function held(
  root: string,
  digest: Digest,
  planned: ReadonlySet<string>,
): Promise<readonly string[]> {
  const found = await records(root, digest);
  return found
    .filter((path) => !planned.has(path))
    .map((path) => nameOf(root, digest, path))
    .sort();
}

/**
 * Every record this identity holds under the root, as full `.json` paths.
 *
 * One walk serves both layouts: `flat` puts the identity partitions directly
 * under the root and `beside` scatters them among the subjects' own
 * directories, and in both cases the thing being looked for is a directory
 * named for this digest — in either spelling `placement.ts` reads — with
 * records directly inside it. A directory that is some *other* machine's
 * partition is not descended into — its contents are baselines this run is not
 * entitled to an opinion about — and a directory that is not a partition at all
 * is a `beside` subject folder, so it is.
 *
 * `by-document` is the render cache, which lives inside the identity partition
 * when the cache root was not split off. It is not read here for the same
 * reason nothing else reads it as a baseline: it is keyed by document digest,
 * so every entry is a file with no subject name in it at all.
 *
 * Records rather than images, for the reason `durable.ts` scans records when it
 * looks for a subject's other identities: a subject with no pixels has a
 * sidecar and no PNG, and a scan of the images would report that subject as one
 * nobody ever approved.
 */
async function records(root: string, digest: Digest): Promise<readonly string[]> {
  const entries = await orAbsent(() => readdir(root, { withFileTypes: true }), root);
  if (entries === null) return [];

  const found: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (!entry.isDirectory()) continue;
    const identity = identityOfPartition(entry.name);
    if (identity === digest) {
      const inside = await orAbsent(() => readdir(path, { withFileTypes: true }), path);
      for (const record of inside ?? []) {
        if (record.isFile() && record.name.endsWith('.json')) found.push(join(path, record.name));
      }
      continue;
    }
    if (identity !== undefined) continue;
    found.push(...(await records(path, digest)));
  }
  return found;
}

/**
 * The name an operator will recognise, recovered from the path that holds it.
 *
 * The identity segment comes out because the caller already knows which
 * renderer it asked about, and the directories above it stay: under `beside`
 * they are the subject id's own segments, and dropping them would report
 * `primary` for three different components.
 *
 * The leaf is decoded, because `flat` percent-encodes the whole id into it. A
 * leaf too long for a filename was truncated and given a digest, and decoding
 * one can fail on the half of an escape the cut left behind — so a name that
 * will not decode is reported as it is spelled on disk, which is still the
 * thing to go and look at.
 */
function nameOf(root: string, digest: Digest, path: string): string {
  const parts = relative(root, path.slice(0, -'.json'.length)).split(sep);
  const named = parts.filter((part) => identityOfPartition(part) !== digest);
  const leaf = named.at(-1) ?? basename(path);
  return [...named.slice(0, -1), decoded(leaf)].join('/');
}

function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
