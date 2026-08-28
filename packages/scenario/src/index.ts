/**
 * Runtime scenarios: named Arrange states, authored Act transitions, and variance assessment.
 *
 * The package is inquiry only. Its values do not write baselines, history, approvals, or exit
 * codes. Durable text retention is an explicit second entrypoint at `scenario/archive`.
 */

export type {
  PreconditionAxisStep,
  PreconditionLink,
  ScenarioAct,
  ScenarioActRef,
  ScenarioAssessment,
  ScenarioBlindSide,
  ScenarioComparison,
  ScenarioDefinition,
  ScenarioDivergence,
  ScenarioEffectDivergence,
  ScenarioExecution,
  ScenarioFrame,
  ScenarioObservation,
  ScenarioOutcome,
  ScenarioParting,
  ScenarioRun,
  ScenarioTransitionAssessment,
  ScenarioUnmatchedAct,
  ScenarioVariance,
  UnobservedScenarioOutcome,
} from './contract.js';
export {
  defineScenario,
  recordAct,
  semanticSnapshotDigest,
  startScenario,
  unobserved,
} from './execution.js';
export type { StartScenarioOptions } from './execution.js';
export { assessScenarios } from './assessment.js';
export { foldScenarios } from './machine.js';
export type {
  ScenarioMachine,
  ScenarioMachineDivergence,
  ScenarioMachineNode,
  ScenarioMachineTransition,
  ScenarioUnknownTransition,
} from './machine.js';
