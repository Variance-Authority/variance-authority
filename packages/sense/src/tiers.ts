/**
 * How much code a package pulls in, placed against budgets the repository
 * wrote down: the `tiers` key of the root config.
 *
 * A tier is a budget in effective lines over a package's runtime closure, the
 * largest first. Tier 0's budget labels it and does not limit it. A package is
 * never given a tier: its tier is the highest-numbered one whose budget holds
 * its closure, and a closure that reached code it could not size places it at
 * that tier *or a lower-numbered one*, because the true size is larger.
 *
 * The closure is the code map's (`orient_map_closure.rs`); this module only
 * reads the budgets and compares, so every consumer places a package the same way.
 */

// compass: variance-authority.reach.relations

import { rootConfig } from './test-selection/cache-layers.js';

/** Budgets in effective lines, tier 0 first, strictly decreasing. */
export type Tiers = readonly number[];

/** A `tiers` value the declaration's rules refuse. */
export class TiersError extends Error {
  constructor(
    readonly where: string,
    readonly said: string,
  ) {
    super(`${where}: "tiers" ${said}`);
    this.name = 'TiersError';
  }
}

/** Check a `tiers` value. Pure, so the CLI parses the same value with the same rules. */
export function parseTiers(value: unknown, where: string): Tiers {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TiersError(where, `must be a non-empty array of budgets in effective lines, tier 0 first, not ${JSON.stringify(value)}`);
  }
  value.forEach((budget: unknown, at) => {
    if (typeof budget !== 'number' || !Number.isInteger(budget) || budget <= 0) {
      throw new TiersError(where, `must hold positive whole numbers of lines; tier ${at} is ${JSON.stringify(budget)}`);
    }
    if (at > 0 && budget >= (value[at - 1] as number)) {
      throw new TiersError(where, `must decrease: a higher tier is a smaller budget, and tier ${at} (${budget}) is not below tier ${at - 1} (${value[at - 1]})`);
    }
  });
  return value as number[];
}

/** The budgets the root config of `root`'s repository declares, or undefined when it declares none. */
export function declaredTiers(root: string): Tiers | undefined {
  const config = rootConfig(root);
  if (config === undefined || config.value['tiers'] === undefined) return undefined;
  return parseTiers(config.value['tiers'], config.file);
}

/** A package's place among the tiers. */
export interface TierPlace {
  readonly tier: number;
  /** The closure reached code it could not size: the true tier is `tier` or a lower-numbered one. */
  readonly atMost: boolean;
}

/**
 * The highest-numbered tier whose budget holds `lines`; tier 0 holds everything.
 * Unsized code can only move a package to a lower-numbered tier, so a package
 * already in tier 0 is placed exactly.
 */
export function tierOf(tiers: Tiers, closure: { readonly lines: number; readonly unsizedFiles: number }): TierPlace {
  let tier = 0;
  for (let at = tiers.length - 1; at > 0; at -= 1) {
    if (closure.lines <= tiers[at]!) {
      tier = at;
      break;
    }
  }
  return { tier, atMost: tier > 0 && closure.unsizedFiles > 0 };
}

/** `tier 3`, or `tier ≤ 3` when the size is a lower bound. */
export function tierLabel(place: TierPlace): string {
  return `tier ${place.atMost ? '≤ ' : ''}${place.tier}`;
}
