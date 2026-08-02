import {
  ALLOWLIST_VERSION,
  RULESET_VERSION,
  digestValue,
  planIdentity,
  type Plan,
  type ToolDeclaration,
} from '@variance-authority/core';
import { DEFAULT_POLICY, type DiffPolicy } from './compare.js';
import { RASTER_RECIPE, recipeDigest, type Recipe } from './stabilize.js';

/**
 * The composition this project ships, declared rather than implied.
 *
 * It is an example. The architecture's claim is that a pipeline belongs to the
 * caller, and that claim is only true if the shipped one is assembled from the
 * same declarations anybody else would use — so this file contains no privileged
 * knowledge and nothing here is required to build a different plan.
 *
 * What it buys is the thing a hand-written identity cannot: **swapping a tool
 * moves the address of everything downstream.** Change the comparator, retune
 * the clustering, bump the ruleset, and the plan digest moves — so a baseline
 * produced by the old composition is `incomparable` with a run produced by the
 * new one, rather than being compared and the difference blamed on a component.
 * That failure is not hypothetical: an identity listing the machine, the scale
 * and the fonts is blind to every one of those changes.
 */

export interface PlanOptions {
  readonly policy?: DiffPolicy;
  /** Grid at which neighbouring changed pixels count as one place. */
  readonly cell?: number;
  readonly stabilization?: Recipe;
}

/** The default clustering granularity, restated here so it enters the identity. */
export const DEFAULT_CELL = 8;

export function defaultPlan(options: PlanOptions = {}): Plan {
  const policy = options.policy ?? DEFAULT_POLICY;
  const cell = options.cell ?? DEFAULT_CELL;
  const recipe = options.stabilization ?? RASTER_RECIPE;

  const tools: ToolDeclaration[] = [
    {
      id: 'acquire-dom',
      kind: 'acquire',
      needs: 'semantic',
      because:
        'reads the live tree and keeps only the CSS that applies to the subject, so what is ' +
        'compared is the subject rather than the document it happened to be mounted in',
      // The pruning ruleset and the property allowlist decide what survives to be
      // compared. A change to either changes every answer, and nothing about the
      // machine would notice.
      identity: digestValue({ ruleset: RULESET_VERSION, allowlist: ALLOWLIST_VERSION }),
    },
    {
      id: 'prepare-recipe',
      kind: 'prepare',
      needs: 'layout',
      because: 'holds the subject still, at the cost of an image that is not quite the product',
      identity: recipeDigest(recipe),
    },
    {
      id: 'render-chromium',
      kind: 'render',
      needs: 'raster',
      because: 'paints the assembled document, here or on a machine that pins its pixels',
      // The engine build is already in `RenderIdentity`; what belongs here is
      // that this plan renders at all.
      identity: 'nothing',
    },
    {
      id: 'compare-pixelmatch',
      kind: 'compare',
      needs: 'raster',
      because: 'stops at a mask rather than a count, because a count cannot be assigned to anyone',
      identity: digestValue({
        policy: policy.id,
        threshold: policy.threshold,
        includeAA: policy.includeAA,
      }),
    },
    {
      id: 'isolate-grid',
      kind: 'isolate',
      needs: 'raster',
      because: 'clusters changed pixels into places, so a diff becomes somewhere rather than a number',
      identity: digestValue({ cell }),
    },
    {
      id: 'map-provenance',
      kind: 'map',
      needs: 'semantic',
      because: 'joins places to the box tree, the component that produced each node, and its file',
      identity: 'nothing',
    },
    {
      id: 'judge-bands',
      kind: 'judge',
      needs: 'semantic',
      because: 'orders causes above collateral, which area alone gets backwards',
      identity: 'nothing',
    },
  ];

  return tools;
}

/** The shipped composition, and the digest that addresses everything it produces. */
export const DEFAULT_PLAN: Plan = defaultPlan();

export function defaultPlanIdentity(options: PlanOptions = {}): string {
  return planIdentity(defaultPlan(options));
}
