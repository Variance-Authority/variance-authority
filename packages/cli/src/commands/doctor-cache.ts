// compass: variance-authority.retention

import {
  machineOwners,
  mib,
  planPrune,
  PRUNE_REASONS,
  type KeptEntry,
  type PrunePlan,
} from '@variance-authority/sense/test-selection';
import type { Config } from '../config.js';
import { CACHE_PRUNE_REASONS, checkoutOwners, planCachePrune } from './prune-cache.js';
import { cacheOf } from './resources.js';

/**
 * The cache besides renders, as doctor reports it: what it holds, what the
 * next prune removes and by which rule, and what it keeps because the owner of
 * the answer could not give one.
 *
 * The render cache has its own finding, because its bound is a size and an
 * age; everything here is removed on the word of git, the file system or the
 * process table, and the reading says whose word it was.
 */

/** Both plans, read from this machine. What `DoctorProbes.cache` returns. */
export interface CacheReading {
  readonly root: string;
  readonly held: number;
  readonly remove: readonly { readonly path: string; readonly bytes: number; readonly words: readonly [string, string] }[];
  readonly kept: readonly KeptEntry[];
}

export interface CacheFinding {
  readonly root: string;
  readonly held: number;
  /** One per rule that would remove something, largest first. */
  readonly removable: readonly { readonly count: number; readonly bytes: number; readonly words: readonly [string, string] }[];
  /** One per reason something is kept, with how many. */
  readonly kept: readonly { readonly count: number; readonly because: string }[];
}

/** Read both plans: the test-selection layers, and the CLI's per-commit directories. */
export async function readCache(config: Pick<Config, 'cacheRoot'>): Promise<CacheReading> {
  const root = cacheOf(config);
  const selection = await planPrune(root, machineOwners(), { measure: true });
  const commits = await planCachePrune(config, checkoutOwners(), { measure: true });
  const worded = <Reason extends string>(
    plan: PrunePlan<Reason>,
    words: Readonly<Record<Reason, readonly [string, string]>>,
  ) => plan.remove.map((entry) => ({ path: entry.path, bytes: entry.bytes, words: words[entry.reason] }));
  return {
    root,
    held: (selection.held ?? 0) + (commits.held ?? 0),
    remove: [...worded(selection, PRUNE_REASONS), ...worded(commits, CACHE_PRUNE_REASONS)],
    kept: [...selection.kept, ...commits.kept],
  };
}

export function cacheFinding(reading: CacheReading): CacheFinding {
  const removable = new Map<string, { count: number; bytes: number; words: readonly [string, string] }>();
  for (const entry of reading.remove) {
    const group = removable.get(entry.words[0]) ?? { count: 0, bytes: 0, words: entry.words };
    group.count += 1;
    group.bytes += entry.bytes;
    removable.set(entry.words[0], group);
  }
  const kept = new Map<string, number>();
  for (const entry of reading.kept) kept.set(entry.reason, (kept.get(entry.reason) ?? 0) + 1);
  return {
    root: reading.root,
    held: reading.held,
    removable: [...removable.values()].sort((left, right) => right.bytes - left.bytes),
    kept: [...kept].map(([because, count]) => ({ count, because })),
  };
}

export function formatCache(finding: CacheFinding): readonly string[] {
  const removing = finding.removable.reduce((total, group) => total + group.bytes, 0);
  return [
    `cache: ${mib(finding.held)} besides renders`,
    `  ${finding.root}`,
    '  a run prunes it once a day; `variance doctor --prune` prunes it now',
    ...(finding.removable.length === 0
      ? ['  the next prune removes nothing']
      : [
          `  the next prune removes ${mib(removing)}:`,
          ...finding.removable.map(
            (group) => `    ${group.count} ${group.words[group.count === 1 ? 0 : 1]}, ${mib(group.bytes)}`,
          ),
        ]),
    ...(finding.kept.length === 0
      ? []
      : ['  kept, because the rule for them could not be checked:', ...finding.kept.map((group) => `    ${group.count}: ${group.because}`)]),
  ];
}
