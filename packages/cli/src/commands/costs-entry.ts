import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ShareEntry } from '@variance-authority/core/share';
import type { Config } from '../config.js';
import { suiteIndexRoot } from './resources.js';
import { isSlice, type CliRunReport } from './run-report.js';
import type { Costs } from './shard.js';

/**
 * What each subject cost one run, as bytes: the file this machine keeps under
 * the commit, and the entry a publish gives the line.
 *
 * Beside the suite index and not inside it. The index is a fact about a commit
 * — two machines composing one tree write it byte for byte — and a timing is a
 * fact about one machine on one afternoon, so folding it in would end that
 * equality. It travels the same road instead, under its own entry name.
 *
 * A leaf, so `share.ts` can publish it and `costs.ts` can read it back through
 * `share.ts` without either importing the other.
 */

/** The entry subject costs are published under. Carries its version. */
export const SUBJECT_COSTS_ENTRY = 'subject-costs-v1';

interface CostsFile {
  readonly version: 1;
  readonly commit: string;
  /** Subject id to whole milliseconds, keys in code-unit order. */
  readonly costs: Readonly<Record<string, number>>;
  /**
   * Subject id to the file declaring it, for the subjects whose collector names
   * one. Optional within version 1: a reader that predates it reads the costs
   * and ignores the rest, and a file without it prices subjects and no file.
   */
  readonly files?: Readonly<Record<string, string>>;
}

/** Costs as read back, with the declaring files when the writer knew them. */
export interface CostsRead {
  readonly costs: Costs;
  readonly files?: ReadonlyMap<string, string>;
}

export function costsPath(config: Pick<Config, 'project' | 'cacheRoot'>, commit: string): string {
  return join(suiteIndexRoot(config), config.project, `${commit}.costs.json`);
}

/** Every observed subject's `costMs`, rounded; a subject with none is left out. */
export function costsOf(report: Pick<CliRunReport, 'observations'>): Costs {
  const costs = new Map<string, number>();
  for (const observation of report.observations) {
    if (observation.costMs !== undefined) costs.set(observation.subject, Math.round(observation.costMs));
  }
  return costs;
}

/** The file declaring each timed subject, where the report carried one. */
export function filesOf(report: Pick<CliRunReport, 'observations'>): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const observation of report.observations) {
    if (observation.costMs !== undefined && observation.declaredIn !== undefined) {
      files.set(observation.subject, observation.declaredIn);
    }
  }
  return files;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function encodeCosts(commit: string, costs: Costs, files: ReadonlyMap<string, string> = new Map()): Uint8Array {
  const ids = [...costs.keys()].sort(byCodeUnit);
  const declared = ids.filter((id) => files.has(id));
  const file: CostsFile = {
    version: 1,
    commit,
    costs: Object.fromEntries(ids.map((id) => [id, costs.get(id)!])),
    ...(declared.length === 0 ? {} : { files: Object.fromEntries(declared.map((id) => [id, files.get(id)!])) }),
  };
  return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
}

export function decodeCosts(bytes: Uint8Array): CostsRead | null {
  try {
    const file = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CostsFile>;
    if (file.version !== 1 || typeof file.costs !== 'object' || file.costs === null) return null;
    const costs = new Map<string, number>();
    for (const [id, ms] of Object.entries(file.costs)) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) costs.set(id, ms);
    }
    if (typeof file.files !== 'object' || file.files === null) return { costs };
    const files = new Map<string, string>();
    for (const [id, path] of Object.entries(file.files)) {
      if (typeof path === 'string' && costs.has(id)) files.set(id, path);
    }
    return files.size === 0 ? { costs } : { costs, files };
  } catch {
    return null;
  }
}

/**
 * This report's costs under its commit, kept on this machine; or why there are
 * none to keep.
 *
 * The suite index's rule: a report with no commit keeps nothing, because costs
 * addressed by a guess would balance the next build on them. One shard's report
 * keeps nothing either — it timed a slice, and a slice kept under the commit
 * would price every other shard's files at the median. The shards' merge is the
 * whole suite, and `share --publish` over every shard's report takes it.
 */
export async function keepCosts(
  config: Pick<Config, 'project' | 'cacheRoot'>,
  report: CliRunReport,
): Promise<{ readonly commit: string; readonly bytes: Uint8Array; readonly subjects: number } | { readonly none: string }> {
  const commit = report.run?.commit;
  if (commit === undefined) return { none: 'this report names no commit' };
  if (isSlice(report)) return { none: 'this report is one shard; publish the shards together' };
  const costs = costsOf(report);
  if (costs.size === 0) return { none: 'this report timed no subject' };
  const bytes = encodeCosts(commit, costs, filesOf(report));
  await keepCostBytes(config, commit, bytes);
  return { commit, bytes, subjects: costs.size };
}

/** Write costs this machine was handed, so the next command reads them from disk. */
export async function keepCostBytes(
  config: Pick<Config, 'project' | 'cacheRoot'>,
  commit: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    const path = costsPath(config, commit);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  } catch {
    // A cache this machine could not write is a cache this machine does without.
  }
}

/** The costs this machine keeps under `commit`, or nothing. */
export async function keptCosts(config: Pick<Config, 'project' | 'cacheRoot'>, commit: string): Promise<CostsRead | null> {
  try {
    return decodeCosts(await readFile(costsPath(config, commit)));
  } catch {
    return null;
  }
}

/** The entry a publish gives the line, or why this report has none. */
export async function costsEntryOf(
  config: Pick<Config, 'project' | 'cacheRoot'>,
  report: CliRunReport,
  at: { readonly commit: string; readonly head?: string },
): Promise<ShareEntry | { readonly none: string }> {
  const kept = await keepCosts(config, report);
  if ('none' in kept) return kept;
  return { name: SUBJECT_COSTS_ENTRY, ...at, bytes: kept.bytes };
}
