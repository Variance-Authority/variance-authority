import type { Config } from '../config.js';
import { costsPath, decodeCosts, keepCostBytes, keepCosts, keptCosts, SUBJECT_COSTS_ENTRY } from './costs-entry.js';
import { workersOf } from './lanes.js';
import type { CliRunReport } from './run-report.js';
import { mainlineEntry, type Here } from './share.js';
import type { Costs } from './shard.js';

export { costsOf, costsPath } from './costs-entry.js';

/**
 * What each subject cost the last mainline run, and where the next run finds it.
 *
 * Read from the reader's mainline, the line the suite index is read from, and
 * at the commit the line names. That is what makes it safe to balance on: every
 * shard of one build reads the same line and computes the same placement. A
 * shard that read a different commit says which in every exclusion it writes,
 * and the merge refuses the overlap.
 *
 * Nothing here can fail a run. A cost that is not found places by checksum,
 * which is what a run without one always did.
 */

export interface MainlineCosts {
  /** The mainline the costs were read from. */
  readonly mainline: string;
  readonly commit: string;
  /** Commits the costs are behind `HEAD`'s merge base with the mainline; negative when ahead. */
  readonly distance?: number;
  readonly costs: Costs;
  /** Subject id to its declaring file, when the run that timed it knew one. */
  readonly files?: ReadonlyMap<string, string>;
}

/**
 * The costs the reader's mainline holds; this machine's copy at that commit
 * first, then the line's, which is kept so the next command reads it from disk.
 */
export async function mainlineCosts(
  config: Config,
  options: Here & { readonly mainline?: string } = {},
): Promise<MainlineCosts | null> {
  const found = await mainlineEntry(config, SUBJECT_COSTS_ENTRY, options);
  if ('miss' in found) return null;
  const { at, held } = found;
  const where = { mainline: at.mainline, commit: at.commit, ...(at.distance === undefined ? {} : { distance: at.distance }) };
  const local = await keptCosts(config, at.commit);
  if (local !== null) return { ...where, ...local };

  const bytes = await held.bytes();
  if (!(bytes instanceof Uint8Array)) return null;
  const read = decodeCosts(bytes);
  if (read === null) return null;
  await keepCostBytes(config, at.commit, bytes);
  return { ...where, ...read };
}

/**
 * The costs a run places by, read only when something is placed by them: a
 * shard's files, or the order several workers take them in. Every shard of a
 * build descends from one merge base, so every shard reads the same costs and
 * agrees on placement.
 */
export async function costsToPlace(
  config: Config,
  sharded: boolean,
): Promise<{ readonly costs?: MainlineCosts }> {
  const costs = sharded || workersOf(config) > 1 ? await mainlineCosts(config) : null;
  return costs === null ? {} : { costs };
}

/**
 * What a run prints about its costs, empty when there is nothing to say — the
 * way `publishedLine` says nothing about a suite index a run with no commit
 * could not address. A run keeps them; `share --publish` gives them to the line.
 */
export async function publishedCostsLine(config: Config, report: CliRunReport): Promise<string> {
  const kept = await keepCosts(config, report);
  return 'none' in kept ? '' : `subject costs: ${costsPath(config, kept.commit)}\n`;
}
