import type { ScenarioArchiveManifest } from '@variance-authority/scenario/archive';
import { stringArg, type Tool } from './tool.js';

export type ScenarioEvidence = readonly ScenarioArchiveManifest[];

/** Witnessed Arrange states and authored Act outcomes from retained scenario manifests. */
export const scenarios: Tool<ScenarioEvidence> = {
  name: 'variance_scenarios',
  description:
    'List retained runtime scenarios, or show one witnessed Arrange state and each authored Act outcome without inventing missing frames.',
  inputSchema: {
    type: 'object',
    properties: {
      scenario: { type: 'string', description: 'Scenario id.' },
      execution: { type: 'string', description: 'Optional execution id when a scenario has several.' },
    },
    additionalProperties: false,
  },
  run(manifests, input) {
    if (input['scenario'] === undefined) return listing(manifests);
    const scenario = stringArg(input, 'scenario');
    const execution = input['execution'] === undefined ? undefined : stringArg(input, 'execution');
    const candidates = manifests.filter((manifest) =>
      manifest.definition.id === scenario &&
      (execution === undefined || manifest.execution.id === execution));
    if (candidates.length === 0) return `No retained scenario matches ${scenario}${execution === undefined ? '' : ` / ${execution}`}.`;
    if (candidates.length > 1) {
      return `${candidates.length} executions match ${scenario}; choose one:\n${candidates.map((manifest) => `  ${manifest.execution.id}`).join('\n')}`;
    }
    return describe(candidates[0]!);
  },
};

function listing(manifests: ScenarioEvidence): string {
  if (manifests.length === 0) return 'The scenario archive contains no manifests.';
  return [
    `${manifests.length} retained scenario execution(s):`,
    ...manifests.map((manifest) =>
      `  ${manifest.definition.id} / ${manifest.execution.id} — Arrange ${manifest.execution.precondition.id}, ${Math.max(0, manifest.execution.frames.length - 1)} Act frame(s)`),
  ].join('\n');
}

function describe(manifest: ScenarioArchiveManifest): string {
  const execution = manifest.execution;
  const frames = execution.frames.map((frame) => {
    const name = frame.at === 0
      ? `Arrange ${execution.precondition.id}`
      : `Act ${frame.act?.key ?? 'missing identity'} #${frame.act?.occurrence ?? '?'}`;
    if (frame.outcome.kind === 'observed') return `  ${frame.at}. ${name} → observed state ${frame.outcome.state}`;
    return `  ${frame.at}. ${name} → unobserved: ${frame.outcome.diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`;
  });
  return [
    `${manifest.definition.id} / ${execution.id}`,
    `Profile: ${execution.profile}. Retained until ${manifest.retainUntil}.`,
    execution.preconditionLink === undefined
      ? 'Arrange relation: not supplied.'
      : execution.preconditionLink.kind === 'resolved'
        ? `Arrange relation: ${execution.preconditionLink.how} parent ${execution.preconditionLink.parent}.`
        : `Arrange relation: unresolved — ${execution.preconditionLink.because}`,
    '',
    ...frames,
    ...(execution.termination === undefined
      ? []
      : ['', `Witnessed prefix ended: ${execution.termination.map((diagnostic) => diagnostic.message).join('; ')}`]),
  ].join('\n');
}
