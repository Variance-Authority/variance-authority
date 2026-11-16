/**
 * Jest's transform cache, restored by the host cache before a shard's tests.
 *
 * A CI runner's disk is new each job, so every shard transforms every file it
 * loads again; on jestjs/jest's own suite that was 43% of a shard's wall time,
 * and a restore of the cache took 0.05 s (issue #1403). `actions/cache` is the
 * transport, and it asks for a path and a key. The path is Jest's own answer,
 * `defaults.cacheDirectory` from the `jest-config` the project's Jest resolves.
 * The key holds the suite, the shard and the ISO week: a shard placed by time
 * takes nearly the same files each run, so it keeps an entry of its own, and an
 * entry is never overwritten, so the week bounds how far it grows. No restore
 * key names an earlier week, so a new week starts from an empty cache.
 *
 * Restore alone: the cache action saves in its own post step, after the tests,
 * when the restore missed the exact key and the path holds something.
 */

// compass: variance-authority.retention

import { createRequire } from 'node:module';
import { jestDependency, type DeclaredSuite } from '@variance-authority/sense/test-selection';
import type { Shard } from '../shard-args.js';
import type { Cached } from './carry.js';

export interface TransformAsk {
  readonly root: string;
  readonly suites: readonly DeclaredSuite[];
  /** The line the keys are cut for; absent off a host run. */
  readonly line: string | undefined;
  /** The other mainlines, whose entries for the same week a restore falls back to. */
  readonly mainlines: readonly string[];
  readonly shard: Shard | undefined;
  readonly now: Date;
}

/** One cached transform cache per declared suite, or a note saying why there is none. */
export function transformCached(ask: TransformAsk): { readonly cached: readonly Cached[]; readonly notes: readonly string[] } {
  if (ask.suites.length === 0) return { cached: [], notes: [] };
  if (ask.line === undefined) {
    return { cached: [], notes: ["Jest's transform cache is carried by the host cache, and this is not a host run, so it has no key here"] };
  }
  const directory = cacheDirectory(ask.root);
  if (typeof directory !== 'string') return { cached: [], notes: [directory.note] };
  const week = isoWeek(ask.now);
  const shard = ask.shard === undefined ? '' : `-${ask.shard.index}of${ask.shard.total}`;
  return {
    cached: ask.suites.map((suite) => {
      const at = (line: string): string => `variance-transform-${suite.name}${shard}:${line}:${week}`;
      return { artifact: `transform-${suite.name}`, paths: [directory], key: at(ask.line ?? ''), restoreKeys: ask.mainlines.map(at) };
    }),
    notes: [],
  };
}

/** Jest's default cache directory, as the `jest-config` the project's Jest resolves answers it. */
function cacheDirectory(root: string): string | { readonly note: string } {
  let config: string;
  try {
    config = jestDependency(root, 'jest-config');
  } catch {
    return { note: `no Jest's transform cache is carried: jest-config does not resolve from ${root}` };
  }
  let directory: unknown;
  try {
    // No import names the project's jest-config: it is the copy its Jest resolves.
    directory = (createRequire(config)(config) as { defaults?: { cacheDirectory?: unknown } }).defaults?.cacheDirectory;
  } catch (error) {
    return { note: `no Jest's transform cache is carried: ${config} does not load (${error instanceof Error ? error.message : String(error)})` };
  }
  if (typeof directory !== 'string' || directory === '') {
    return { note: `no Jest's transform cache is carried: ${config} names no defaults.cacheDirectory` };
  }
  return directory;
}

/** `YYYY-Www`: the ISO 8601 week, Monday first, in UTC, of the year its Thursday falls in. */
export function isoWeek(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
