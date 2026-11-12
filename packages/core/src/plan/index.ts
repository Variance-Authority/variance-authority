/**
 * `@variance-authority/core/plan` — a composition as a value.
 *
 * The declaration every tool carries, the list a caller assembles from them, and
 * the identity derived from that list. Its own entrypoint because assembling a
 * pipeline is a thing somebody does *before* they have any of the values the
 * other groups describe — and because the identity is the mechanism that makes
 * "declare what you did" enforceable rather than promised.
 */

export { planIdentity, validatePlan, planForTier, describePlan } from './tool.js';
export type {
  ToolKind,
  Tier,
  IdentityContribution,
  ToolDeclaration,
  Plan,
  PlanProblem,
} from './tool.js';
