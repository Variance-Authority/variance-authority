import { describe, expect, it } from 'vitest';
import {
  describePlan,
  planForTier,
  planIdentity,
  validatePlan,
  type Plan,
  type ToolDeclaration,
} from './tool.js';

/**
 * The plan, tested for the thing a hand-maintained identity gets wrong.
 *
 * A composition that addresses its results by machine, scale and fonts alone
 * cannot tell that the *code* changed. Swap the comparator and two results
 * produced by different systems compare as though produced by the same one —
 * which is a false `unchanged` arriving through the provenance layer instead of
 * through the differ.
 */

const tool = (
  id: string,
  kind: ToolDeclaration['kind'],
  needs: ToolDeclaration['needs'],
  identity: ToolDeclaration['identity'] = 'nothing',
): ToolDeclaration => ({ id, kind, needs, identity, because: `${id} does its job` });

const PLAN: Plan = [
  tool('acquire-dom', 'acquire', 'semantic', 'v1:ruleset-7'),
  tool('render-chromium', 'render', 'raster', 'v1:chromium-131'),
  tool('compare-pixelmatch', 'compare', 'raster', 'v1:policy-default'),
  tool('isolate-grid', 'isolate', 'raster', 'v1:cell-8'),
  tool('map-provenance', 'map', 'semantic'),
  tool('judge-policy', 'judge', 'semantic', 'v1:policy-strict'),
];

describe('identity comes from the parts', () => {
  it('moves when a tool is swapped for another', () => {
    // The failure this exists to prevent. A different comparator is a different
    // system, and two results it produced must not be addressed identically to
    // two the old one produced.
    const swapped = PLAN.map((entry) =>
      entry.id === 'compare-pixelmatch' ? tool('compare-odiff', 'compare', 'raster', 'v1:odiff') : entry,
    );

    expect(planIdentity(swapped)).not.toBe(planIdentity(PLAN));
  });

  it('moves when a tool is reconfigured without being replaced', () => {
    // Same tool, different threshold. Nothing in a machine-and-fonts identity
    // would notice, and every stored baseline would keep comparing.
    const retuned = PLAN.map((entry) =>
      entry.id === 'isolate-grid' ? tool('isolate-grid', 'isolate', 'raster', 'v1:cell-16') : entry,
    );

    expect(planIdentity(retuned)).not.toBe(planIdentity(PLAN));
  });

  it('depends on the order the tools run in', () => {
    // Unlike an intervention recipe. Isolating before mapping and mapping before
    // isolating are different systems, so the sequence is part of what is
    // addressed.
    expect(planIdentity([...PLAN].reverse())).not.toBe(planIdentity(PLAN));
  });

  it('is stable for the same composition', () => {
    expect(planIdentity([...PLAN])).toBe(planIdentity(PLAN));
  });
});

describe('paying only for the rung you are on', () => {
  it('drops the tools a cheap tier cannot run', () => {
    const semantic = planForTier(PLAN, 'semantic');

    expect(semantic.map((entry) => entry.id)).toEqual([
      'acquire-dom',
      'map-provenance',
      'judge-policy',
    ]);
  });

  it('keeps everything at the most expensive rung', () => {
    expect(planForTier(PLAN, 'raster')).toHaveLength(PLAN.length);
  });
});

describe('what is wrong before anything runs', () => {
  it('refuses a tool that cannot answer at the tier it will run at', () => {
    // Running it anyway is worse than not running it: it reports whatever it
    // managed to observe, and nothing downstream knows the answer is partial.
    const problems = validatePlan(PLAN, 'semantic');

    expect(problems.filter((problem) => problem.severity === 'error').map((p) => p.tool)).toEqual([
      'render-chromium',
      'compare-pixelmatch',
      'isolate-grid',
    ]);
  });

  it('refuses a duplicated tool, because the identity cannot address it', () => {
    const problems = validatePlan([...PLAN, PLAN[0]!], 'raster');

    expect(problems).toContainEqual({
      severity: 'error',
      tool: 'acquire-dom',
      because: 'appears more than once, so the plan identity cannot address it',
    });
  });

  it('warns rather than refuses when a plan reaches no verdict', () => {
    // A legitimate extraction pipeline, and a mistake if something downstream
    // expects a pass or a fail. The caller decides which they built.
    const problems = validatePlan(PLAN.filter((entry) => entry.kind !== 'judge'), 'raster');
    const warning = problems.find((problem) => problem.severity === 'warning');

    expect(warning?.because).toContain('no judge');
    expect(problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  });

  it('passes a well-formed plan at the tier it was built for', () => {
    expect(validatePlan(PLAN, 'raster')).toEqual([]);
  });
});

describe('what a reader is told', () => {
  it('names the tools that will not run and why', () => {
    // The difference between "the button changed" and "the button changed,
    // according to a composition that skipped attribution".
    const text = describePlan(PLAN, 'semantic');

    expect(text).toContain('will not run');
    expect(text).toContain('render-chromium needs raster');
  });

  it('says so plainly when there is no composition at all', () => {
    expect(describePlan([], 'raster')).toContain('observes nothing');
  });
});
