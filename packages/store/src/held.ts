// compass: variance-authority.retention

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Digest } from '@variance-authority/core/format';
import { orAbsent } from './absent.js';
import { identityOfPartition } from './legacy.js';
import type { BaselinePathTemplate } from './path-template.js';

/**
 * What a file-backed store holds and the plan did not name (ADR-0063).
 *
 * Split from `durable.ts` because nothing here decides a verdict: it is a
 * directory walk and a naming rule.
 */

export interface HeldQuery {
  /** The template this store places by. */
  readonly template: BaselinePathTemplate;
  /** The engine family asking, as the template spells it into a path. */
  readonly engine: string;
  /** The identity asking, whose old-layout partitions are its own. */
  readonly digest: Digest;
  /** Paths under the root, without extension, that the plan addresses. */
  readonly planned: ReadonlySet<string>;
}

/**
 * The names held under the root that no planned key addresses, in code-unit order.
 *
 * Two kinds are held. A record at a path the template renders for this engine
 * is named by that path, which is already the name a person reads. A record in
 * this identity's partition of the old layout is named by its directories and
 * its decoded leaf, the partition left out because the caller knows which
 * renderer it asked about.
 *
 * Records rather than images: a subject approved with no pixels has a record
 * and no image, and a scan of images would report it as never approved.
 */
export async function held(root: string, query: HeldQuery): Promise<readonly string[]> {
  const found: string[] = [];
  await walk(root, '', query, found);
  return found.sort();
}

/**
 * One walk serves both kinds, because a template with `{dir}` places baselines
 * anywhere in the repository and an old `beside` partition could be anywhere
 * too.
 *
 * Not descended into: `node_modules`, a directory whose name starts with `.`
 * unless the template names it, another identity's partition — baselines this
 * run is not entitled to an opinion about — and `by-document`, the render
 * cache, which is keyed by document digest and names no subject.
 */
async function walk(directory: string, under: string, query: HeldQuery, found: string[]): Promise<void> {
  const entries = await orAbsent(() => readdir(directory, { withFileTypes: true }), directory);
  if (entries === null) return;
  const named = query.template.source.split('/');
  for (const entry of entries) {
    const path = under === '' ? entry.name : `${under}/${entry.name}`;
    if (entry.isFile()) {
      if (!entry.name.endsWith('.json')) continue;
      const stem = path.slice(0, -'.json'.length);
      if (query.template.matches(stem, query.engine) && !query.planned.has(stem)) found.push(stem);
      continue;
    }
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === 'by-document') continue;
    if (entry.name.startsWith('.') && !named.includes(entry.name)) continue;
    const identity = identityOfPartition(entry.name);
    if (identity === undefined) {
      await walk(join(directory, entry.name), path, query, found);
      continue;
    }
    if (identity !== query.digest) continue;
    const inside = await orAbsent(() => readdir(join(directory, entry.name), { withFileTypes: true }), directory);
    for (const record of inside ?? []) {
      if (!record.isFile() || !record.name.endsWith('.json')) continue;
      const leaf = record.name.slice(0, -'.json'.length);
      if (query.planned.has(`${path}/${leaf}`)) continue;
      found.push(under === '' ? decoded(leaf) : `${under}/${decoded(leaf)}`);
    }
  }
}

/**
 * The old flat layout percent-encoded the whole id into the leaf, and cut a
 * long one short with a digest, which can leave half an escape. A name that
 * will not decode is reported as it is spelled on disk.
 */
function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
