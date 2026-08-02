import { digestCombine, digestValue, type Digest } from '../format/hash.js';

/**
 * The declaration every tool carries, and the plan a caller assembles from them.
 *
 * The architecture says a pipeline is something a user composes rather than
 * something this project ships. That is only true if a composition is a *value*:
 * something that can be listed, checked, printed, and — the part that matters —
 * whose identity is derived from its parts instead of hand-written somewhere
 * else.
 *
 * The hand-written version is the bug this file exists to remove. When the
 * identity of a result enumerates the machine, the scale, the fonts and the
 * tricks, swapping a *tool* — a different pruner, a different comparator, a
 * different clustering — leaves that identity untouched. Two results produced by
 * different code then compare as though they were produced by the same code, and
 * the difference is attributed to whichever component happens to sit under it.
 * Contract 2 says declare what you did; a list somebody maintains by hand is a
 * promise, and this is the mechanism.
 */

export type ToolKind =
  | 'acquire'
  | 'prepare'
  | 'render'
  | 'hash'
  | 'compare'
  | 'isolate'
  | 'map'
  | 'judge'
  | 'record';

/**
 * The cheapest representation that can answer a question.
 *
 * Ordered, and the order is the cost. A tool declares the rung it needs, and a
 * plan running at a lower rung is told which of its tools cannot do their job —
 * rather than running them anyway and reporting whatever they manage.
 */
export type Tier = 'reachability' | 'semantic' | 'layout' | 'raster';

const TIER_ORDER: Record<Tier, number> = {
  reachability: 0,
  semantic: 1,
  layout: 2,
  raster: 3,
};

/**
 * What a tool contributes to the identity of what it produces.
 *
 * `'nothing'` is a decision, not a default. A tool that genuinely cannot change
 * an answer says so out loud, and the difference between "contributes nothing"
 * and "nobody thought about it" stays visible — the same distinction contract 3
 * makes everywhere else, applied to provenance.
 */
export type IdentityContribution = Digest | 'nothing';

export interface ToolDeclaration {
  /**
   * Stable identifier, and part of the plan's identity.
   *
   * Renaming a tool is therefore a new identity. That is correct: nothing
   * downstream can know that two names referred to one implementation.
   */
  readonly id: string;
  readonly kind: ToolKind;
  readonly needs: Tier;
  /** One sentence: what it does, and what it costs. */
  readonly because: string;
  /**
   * Everything about this tool's configuration that could change its answer.
   *
   * A version, a policy, a threshold, a ruleset. Not its inputs — those are
   * addressed separately — only what the tool *is*.
   */
  readonly identity: IdentityContribution;
}

export type Plan = readonly ToolDeclaration[];

/**
 * The identity of a composition.
 *
 * Order-sensitive, unlike an intervention recipe. Two plans containing the same
 * tools in a different order do not produce the same answer — isolating before
 * mapping and mapping before isolating are different systems — so the sequence
 * is part of what is addressed.
 */
export function planIdentity(plan: Plan): Digest {
  return digestCombine(
    'plan',
    plan.map((tool) =>
      digestValue({
        id: tool.id,
        kind: tool.kind,
        needs: tool.needs,
        identity: tool.identity,
      }),
    ),
  );
}

export interface PlanProblem {
  readonly severity: 'error' | 'warning';
  readonly tool: string;
  readonly because: string;
}

/**
 * What is wrong with a composition, before it runs.
 *
 * Returned rather than thrown. A caller assembling a bespoke plan is entitled to
 * a list, and some of what is reported here is a legitimate choice — running a
 * raster tool at a semantic tier is a mistake, but a plan that produces no
 * verdict is a perfectly good extraction pipeline.
 */
export function validatePlan(plan: Plan, tier: Tier): readonly PlanProblem[] {
  const problems: PlanProblem[] = [];
  const seen = new Set<string>();

  for (const tool of plan) {
    if (seen.has(tool.id)) {
      // Two tools under one name make the plan's identity ambiguous: the digest
      // cannot distinguish the composition from one containing either alone.
      problems.push({
        severity: 'error',
        tool: tool.id,
        because: 'appears more than once, so the plan identity cannot address it',
      });
    }
    seen.add(tool.id);

    if (TIER_ORDER[tool.needs] > TIER_ORDER[tier]) {
      problems.push({
        severity: 'error',
        tool: tool.id,
        because:
          `needs the ${tool.needs} tier and this plan runs at ${tier}, so it cannot answer ` +
          'its question — and a tool that runs anyway reports whatever it managed to see',
      });
    }
  }

  if (!plan.some((tool) => tool.kind === 'judge')) {
    problems.push({
      severity: 'warning',
      tool: '(plan)',
      because:
        'contains no judge, so it produces observations and no verdict. Legitimate for an ' +
        'extraction pipeline; a mistake if anything downstream expects a pass or a fail',
    });
  }

  return problems;
}

/** The tools a plan will actually run at a given tier. */
export function planForTier(plan: Plan, tier: Tier): Plan {
  return plan.filter((tool) => TIER_ORDER[tool.needs] <= TIER_ORDER[tier]);
}

/**
 * The plan as something a person reads before trusting a number that came out of it.
 *
 * Printed beside a verdict, this is what lets a reader tell "the button changed"
 * from "the button changed, according to a composition that skipped attribution".
 */
export function describePlan(plan: Plan, tier: Tier): string {
  if (plan.length === 0) return 'an empty plan, which observes nothing';

  const running = planForTier(plan, tier);
  const skipped = plan.filter((tool) => !running.includes(tool));

  return [
    `${running.length} tool(s) at the ${tier} tier — ${planIdentity(plan)}`,
    ...running.map((tool) => `  ${tool.kind.padEnd(8)} ${tool.id} — ${tool.because}`),
    ...(skipped.length > 0
      ? [
          '',
          `${skipped.length} tool(s) need a more expensive tier and will not run:`,
          ...skipped.map((tool) => `  ${tool.id} needs ${tool.needs}`),
        ]
      : []),
  ].join('\n');
}
