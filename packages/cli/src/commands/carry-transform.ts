/**
 * Jest's transform cache, restored by the host cache before a shard's tests.
 *
 * A CI runner's disk is new each job, so every shard transforms every file it
 * loads again; on jestjs/jest's own suite a restored cache cut a shard's wall
 * time by 43%, and the restore took 0.05 s (issue #1403). `actions/cache` is the
 * transport, and it asks for a path and a key. The path is Jest's own answer,
 * `defaults.cacheDirectory` from the `jest-config` the project's Jest resolves.
 * The key holds the suite, the shard and the ISO week: a shard placed by time
 * takes nearly the same files each run, so it keeps an entry of its own, and an
 * entry is never overwritten, so the week bounds how far it grows. No restore
 * key names an earlier week, so a new week starts from an empty cache.
 *
 * Restore alone: the cache action saves in its own post step, after the tests,
 * when the restore missed the exact key and the path holds something. It is
 * carried only when asked for: `carry restore` serves every runner, and a
 * project that runs no Jest has nothing here to read.
 */

// compass: variance-authority.retention

import { jestCacheDirectory, type DeclaredSuite } from '@variance-authority/sense/test-selection';
import type { Shard } from '../shard-args.js';
import type { Cached } from './carry.js';

/** The transform cache a restore is asked for. */
export interface TransformAsked {
  // TODO: Vitest and Rstest keep transform caches too; each joins here when
  // a measurement on its own suite shows the restore pays.
  readonly runner: 'jest';
  /** The shard the job runs, whose entry is its own. */
  readonly shard?: Shard;
  /** When the run is, for the week the entry is keyed by. */
  readonly now: Date;
}

export interface TransformAsk extends TransformAsked {
  readonly root: string;
  readonly suites: readonly DeclaredSuite[];
  /** The line the keys are cut for. */
  readonly line: string;
  /** The other mainlines, whose entries for the same week a restore falls back to. */
  readonly mainlines: readonly string[];
}

/** One cached transform cache per declared suite on a host run, or a note saying why there is none. */
export function transformCached(ask: TransformAsk): { readonly cached: readonly Cached[]; readonly notes: readonly string[] } {
  const found = jestCacheDirectory(ask.root);
  if ('unknown' in found) return { cached: [], notes: [`no Jest's transform cache is carried: ${found.unknown}`] };
  const week = isoWeek(ask.now);
  const shard = ask.shard === undefined ? '' : `-${ask.shard.index}of${ask.shard.total}`;
  return {
    cached: ask.suites.map((suite) => {
      const at = (line: string): string => `variance-transform-${suite.name}${shard}:${line}:${week}`;
      return { artifact: `transform-${suite.name}`, paths: [found.directory], key: at(ask.line), restoreKeys: ask.mainlines.map(at) };
    }),
    notes: [],
  };
}
/** `YYYY-Www`: the ISO 8601 week, Monday first, in UTC, of the year its Thursday falls in. */
export function isoWeek(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
