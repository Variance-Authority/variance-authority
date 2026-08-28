import {
  BANDS,
  decidesBand,
  deriveVariation,
  explainParting,
  observableBands,
  partingOf,
  type SemanticSnapshot,
} from '@variance-authority/core';
import type {
  ScenarioActRef,
  ScenarioAssessment,
  ScenarioBlindSide,
  ScenarioComparison,
  ScenarioEffectDivergence,
  ScenarioFrame,
  ScenarioParting,
  ScenarioRun,
  ScenarioTransitionAssessment,
  ScenarioUnmatchedAct,
  ScenarioVariance,
} from './contract.js';
import { assertScenarioRun } from './execution.js';

/** Compare two witnessed paths without writing a verdict or mutating either execution. */
export function assessScenarios(left: ScenarioRun, right: ScenarioRun): ScenarioAssessment {
  assertScenarioRun(left);
  assertScenarioRun(right);
  const arrange = compareFrames(left.execution.frames[0], right.execution.frames[0], left, right);
  const leftActs = actFrames(left);
  const rightActs = actFrames(right);
  const aligned: ScenarioTransitionAssessment[] = [];
  const unmatched: ScenarioUnmatchedAct[] = [];
  let prefix = 0;

  while (prefix < leftActs.length && prefix < rightActs.length) {
    const leftFrame = leftActs[prefix]!;
    const rightFrame = rightActs[prefix]!;
    if (!sameAct(leftFrame.act!, rightFrame.act!)) break;

    const leftEffect = compareFrames(
      left.execution.frames[prefix],
      leftFrame,
      left,
      left,
    );
    const rightEffect = compareFrames(
      right.execution.frames[prefix],
      rightFrame,
      right,
      right,
    );
    aligned.push({
      act: leftFrame.act!,
      leftEffect,
      rightEffect,
      divergence: compareEffects(leftEffect, rightEffect),
    });
    prefix += 1;
  }

  for (const frame of leftActs.slice(prefix)) unmatched.push({ ...frame.act!, side: 'left' });
  for (const frame of rightActs.slice(prefix)) unmatched.push({ ...frame.act!, side: 'right' });

  return {
    arrange,
    transitions: aligned,
    firstDivergence: firstDivergence(aligned, unmatched, left, right),
    unmatched,
  };
}

function compareFrames(
  leftFrame: ScenarioFrame | undefined,
  rightFrame: ScenarioFrame | undefined,
  left: ScenarioRun,
  right: ScenarioRun,
): ScenarioComparison {
  if (leftFrame === undefined || rightFrame === undefined) {
    return { kind: 'unpaired', because: 'one execution has no corresponding frame' };
  }
  if (leftFrame.outcome.kind === 'unobserved' || rightFrame.outcome.kind === 'unobserved') {
    const sides = [
      ...(leftFrame.outcome.kind === 'unobserved' ? ['left'] : []),
      ...(rightFrame.outcome.kind === 'unobserved' ? ['right'] : []),
    ];
    return { kind: 'unobserved', because: `${sides.join(' and ')} outcome was not observed` };
  }

  const before = left.snapshots.get(leftFrame.outcome.snapshot);
  const after = right.snapshots.get(rightFrame.outcome.snapshot);
  if (before === undefined || after === undefined) {
    const missing = [
      ...(before === undefined ? [leftFrame.outcome.snapshot] : []),
      ...(after === undefined ? [rightFrame.outcome.snapshot] : []),
    ];
    return {
      kind: 'unobserved',
      because: `semantic snapshot ${missing.join(' and ')} is unavailable`,
    };
  }

  return { kind: 'measured', variance: varianceOf(before, after) };
}

function varianceOf(before: SemanticSnapshot, after: SemanticSnapshot): ScenarioVariance {
  const variation = deriveVariation(before, after);
  return {
    digest: variation.digest,
    identical: variation.identical,
    bands: variation.bands,
    components: variation.components.map((component) => component.name),
    unobserved: variation.unobserved,
    blindSides: blindSides(before, after),
    parting: partingBetween(before, after),
  };
}

/**
 * The edge, read for which input made it.
 *
 * Called for both pairs this file measures, because both are the same question
 * asked of different snapshots: an Arrange comparison asks why two executions
 * began differently, a transition effect asks what an Act did. Neither is a
 * regression — there is no baseline in a scenario — so this is `partingOf`'s
 * home ground rather than a borrowed reading.
 *
 * No lifting, unlike the composition graph's use of it: both snapshots are the
 * same subject at two moments, so they are already rooted at the same node and
 * `boundarySnapshot` would have nothing to do. That is the one way the time axis
 * is *easier* than the A/B one.
 *
 * A second comparison after `deriveVariation`'s, and deliberately not fused with
 * it. `compareTrees` returns on matching render hashes, so the edge that moved
 * nothing — the common one on a long path — pays a digest compare, and the edge
 * that did move is the one somebody is about to read a sentence about.
 */
function partingBetween(before: SemanticSnapshot, after: SemanticSnapshot): ScenarioParting {
  const parting = partingOf(before, after);
  return { slice: parting.slice, lines: explainParting(parting) };
}

function blindSides(
  left: SemanticSnapshot,
  right: SemanticSnapshot,
): readonly ScenarioBlindSide[] {
  const here = observableBands(left.profile);
  const there = observableBands(right.profile);
  const blind: ScenarioBlindSide[] = [];

  for (const band of BANDS) {
    const sides: ('left' | 'right')[] = [];
    if (!decidesBand(band, here[band])) sides.push('left');
    if (!decidesBand(band, there[band])) sides.push('right');
    if (sides.length > 0) blind.push({ band, sides });
  }
  return blind;
}

function compareEffects(
  left: ScenarioComparison,
  right: ScenarioComparison,
): ScenarioEffectDivergence {
  if (left.kind === 'unpaired' || right.kind === 'unpaired') {
    return { kind: 'unpaired', because: 'one transition effect has no corresponding effect' };
  }
  if (left.kind === 'unobserved' || right.kind === 'unobserved') {
    return { kind: 'unobserved', because: 'one transition effect was not measured' };
  }
  return {
    kind: 'measured',
    identical: left.variance.digest === right.variance.digest,
    left: left.variance.digest,
    right: right.variance.digest,
  };
}

function firstDivergence(
  transitions: readonly ScenarioTransitionAssessment[],
  unmatched: readonly ScenarioUnmatchedAct[],
  left: ScenarioRun,
  right: ScenarioRun,
): ScenarioAssessment['firstDivergence'] {
  for (const transition of transitions) {
    if (transition.divergence.kind !== 'measured') {
      return {
        kind: 'unresolved',
        because: `the effect of \`${transition.act.key}\` was not measured on both sides`,
      };
    }
    if (!transition.divergence.identical) return { kind: 'found', act: transition.act };
  }

  if (unmatched.length > 0) {
    return { kind: 'unresolved', because: 'the executions contain unmatched authored acts' };
  }
  if (!complete(left) || !complete(right)) {
    return { kind: 'unresolved', because: 'one execution did not observe its complete path' };
  }
  return { kind: 'none' };
}

function actFrames(run: ScenarioRun): readonly ScenarioFrame[] {
  return run.execution.frames.slice(1);
}

function complete(run: ScenarioRun): boolean {
  return (
    run.execution.termination === undefined &&
    run.execution.frames.length === run.definition.acts.length + 1
  );
}

function sameAct(left: ScenarioActRef, right: ScenarioActRef): boolean {
  return left.key === right.key && left.occurrence === right.occurrence;
}
