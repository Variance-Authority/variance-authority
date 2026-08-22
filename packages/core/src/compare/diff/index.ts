import { BANDS, type Band } from '../band.js';
import { aggregateImpact, type AggregateImpact } from '../impact.js';
import { diffEnvironments, type EnvironmentDelta } from '../../format/environment.js';
import type { SemanticSnapshot } from '../../format/snapshot.js';
import { decidesBand, observableBands } from '../observability.js';
import { impactTag, type ChangedComponent, type Delta, type Root } from './delta.js';
import { matchTrees } from './match.js';
import { compareNodes, wholeNode } from './compare-nodes.js';
import { attribute } from './attribution.js';
import { componentsOf } from './components.js';
import { locate } from '../../attribute/locate.js';

export type { ChangedComponent, Delta, Root, RootKind } from './delta.js';
export { matchTrees } from './match.js';
export type { Matching } from './match.js';

export interface SemanticDiff {
  readonly subjectId: string;
  /** `true` when both render hashes agree — nothing below need be consulted. */
  readonly identical: boolean;

  readonly environmentDeltas: readonly EnvironmentDelta[];
  readonly deltas: readonly Delta[];

  /** One entry per explanation. This is what a docket renders and approves. */
  readonly roots: readonly Root[];

  /**
   * Components implicated, separated into causes and collateral.
   *
   * "Eleven components changed" reads like eleven problems. "`Button` changed,
   * and ten components render it" reads like one, which is what it is.
   */
  readonly components: readonly ChangedComponent[];

  /**
   * Whether anything in this change set can move a box.
   *
   * `paint` or `composite` means nothing reflowed and no geometric collateral is
   * possible — a conclusion available without a layout engine, which is how a
   * profile that cannot measure still rules movement out instead of merely
   * failing to observe it.
   */
  readonly impact: AggregateImpact;

  /**
   * Bands this profile could not observe.
   *
   * Reported so that "no geometry deltas" is never mistaken for "geometry is
   * fine" under a profile with no layout engine (ADR-0002).
   */
  readonly unobserved: readonly Band[];
}

/**
 * Compare two snapshots of one subject.
 *
 * @throws {Error} when the snapshots come from different subjects or different
 * observation profiles. Neither is a large diff — they are a category error, and
 * returning deltas for them would let a JSDOM run appear to satisfy a Chromium
 * baseline while blind to every geometry change in it.
 */
export function diffSnapshots(
  baseline: SemanticSnapshot,
  candidate: SemanticSnapshot,
): SemanticDiff {
  if (baseline.subject.id !== candidate.subject.id) {
    throw new Error(
      `refusing to diff different subjects: ${baseline.subject.id} vs ${candidate.subject.id}`,
    );
  }

  if (baseline.profile.id !== candidate.profile.id) {
    throw new Error(
      `refusing to diff across observation profiles: ${baseline.profile.id} vs ${candidate.profile.id}`,
    );
  }

  return { subjectId: candidate.subject.id, ...compareTrees(baseline, candidate) };
}

/** Everything a {@link SemanticDiff} is except the subject it is about. */
export type TreeComparison = Omit<SemanticDiff, 'subjectId'>;

/**
 * The comparison itself, after whatever refusals the caller owes.
 *
 * Split out because two callers owe different refusals over the same arithmetic.
 * `diffSnapshots` produces a **verdict** and must refuse two subjects, because a
 * verdict that crossed them would let one subject's baseline stand in for
 * another's. `deriveVariation` produces an **explanation** of a difference
 * somebody declared on purpose — a dark story against its light parent — where
 * two subject ids are the entire point and a refusal would be the bug.
 *
 * What is not negotiable either way is the observability rule: a band is
 * `unobserved` unless **both** sides could decide it, so a difference that only
 * one profile could have seen is never reported as no difference (ADR-0002).
 * Under `diffSnapshots` the two profiles are already identical, so the union
 * costs it nothing and changes none of its answers.
 */
export function compareTrees(
  baseline: SemanticSnapshot,
  candidate: SemanticSnapshot,
): TreeComparison {
  const here = observableBands(candidate.profile);
  const there = observableBands(baseline.profile);
  const unobserved: Band[] = BANDS.filter(
    (band) => !decidesBand(band, here[band]) || !decidesBand(band, there[band]),
  );

  const environmentDeltas = diffEnvironments(
    baseline.environment.inputs,
    candidate.environment.inputs,
  );

  if (baseline.renderHash === candidate.renderHash) {
    return {
      identical: true,
      environmentDeltas,
      deltas: [],
      roots: [],
      components: [],
      impact: 'paint',
      unobserved,
    };
  }

  const matching = matchTrees(baseline.root, candidate.root);
  const deltas: Delta[] = [];

  for (const node of matching.added) {
    deltas.push(wholeNode('node-added', node));
  }
  for (const node of matching.removed) {
    deltas.push(wholeNode('node-removed', node));
  }

  for (const [before, after] of matching.pairs) {
    if (matching.moved.has(before)) {
      deltas.push(wholeNode('node-moved', after));
    }
    compareNodes(before, after, deltas, candidate.profile.layout && baseline.profile.layout);
  }

  // Orientation is attached after the deltas exist, in one pass over the
  // candidate tree. Doing it during comparison would locate against whichever
  // tree that comparison happened to be holding, and a removal must be located
  // in the tree it was removed *from* — see below.
  const located = deltas.map((delta) => {
    const tree = delta.kind === 'node-removed' ? baseline.root : candidate.root;
    const where = locate(tree, delta.path);

    return where.where === ''
      ? delta
      : {
          ...delta,
          where: where.where,
          ...(where.region !== undefined ? { region: where.region } : {}),
        };
  });

  const roots = attribute(located, matching, environmentDeltas);

  return {
    identical: false,
    environmentDeltas,
    deltas: located,
    roots,
    components: componentsOf(located, roots),
    impact: aggregateImpact(located.map(impactTag)),
    unobserved,
  };
}
