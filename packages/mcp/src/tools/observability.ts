import { distill, formatDistillation } from '@variance-authority/distill';
import type { ObservabilitySubject } from '../observability-subject.js';
import { NO_ARGS, stringArg, type Tool } from './tool.js';

/** Which independent instruments this MCP connection can actually answer from. */
export const observability: Tool<ObservabilitySubject> = {
  name: 'variance_observability',
  description:
    'Inventory every observability domain supplied to this MCP connection, distinguishing unavailable evidence from a completed empty measurement.',
  inputSchema: NO_ARGS,
  run(subject) {
    const presentation = subject.report?.observations.filter(
      (observation) => observation.signals?.presentation !== undefined,
    ).length;
    return [
      'Observability available to this MCP connection:',
      line('visual/report', subject.report, subject.report === undefined
        ? undefined
        : `${subject.report.observations.length} observation(s)`),
      line('durable presentation signals', presentation === undefined ? undefined : true,
        presentation === undefined ? undefined : `${presentation} durable signal(s)`),
      line('presentation readings', subject.presentations,
        subject.presentations === undefined
          ? undefined
          : `${subject.presentations.length} full graph(s)`),
      line('runtime journey', subject.execution,
        subject.execution === undefined
          ? undefined
          : `${subject.execution.tests.length} named test(s), ${subject.execution.modules.length} source module(s)`),
      line('live journey/events', subject.vantage,
        subject.vantage === undefined ? undefined : `${subject.vantage.tests.length} reported test(s)`),
      line('Eyes attention', subject.eyes,
        subject.eyes === undefined ? undefined : `${subject.eyes.tests.length} test journal(s)`),
      line('scenario AAA', subject.scenarios,
        subject.scenarios === undefined ? undefined : `${subject.scenarios.length} retained execution(s)`),
      '',
      'Unavailable means no producer supplied that domain; it is not an empty measurement.',
      ...producerGuidance(subject),
    ].join('\n');
  },
};

/** Distil addressed DOM owners and execution without calling either silence safe. */
export const distillTool: Tool<ObservabilitySubject> = {
  name: 'variance_distill',
  description:
    'Distil one test’s Eyes-addressed components, React update initiators, and Sense runtime journey into reduction opportunities—not safe mocks.',
  inputSchema: {
    type: 'object',
    properties: {
      test: { type: 'string', description: 'An Eyes test id, exact title, or unambiguous title part.' },
    },
    required: ['test'],
    additionalProperties: false,
  },
  run(subject, input) {
    const asked = stringArg(input, 'test');
    try {
      return formatDistillation(distill({
        test: asked,
        ...(subject.eyes === undefined ? {} : { eyes: subject.eyes }),
        ...(subject.execution === undefined ? {} : { execution: subject.execution }),
      }));
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
};

function line(name: string, evidence: unknown, detail: string | undefined): string {
  return evidence === undefined ? `  unavailable — ${name}` : `  available   — ${name}: ${detail}`;
}

function producerGuidance(subject: ObservabilitySubject): readonly string[] {
  const missing = [
    subject.report === undefined
      ? '  visual/report — run `variance run` with a configured `report` path and supply that RunReport; https://variance-authority.dev/start-cli'
      : undefined,
    subject.presentations === undefined
      ? '  presentation readings — acquire PresentationReport values with `@variance-authority/presentation/playwright`; https://variance-authority.dev/presentation'
      : undefined,
    subject.execution === undefined
      ? '  runtime journey — supply an ExecutionIndex from a producer holding stable per-test crossings; Sense ships the query, not that producer; https://variance-authority.dev/reference/packages/sense'
      : undefined,
    subject.vantage === undefined
      ? '  live journey/events — start the watcher first, compose `varianceFixtures`, then start the suite with its exact VANTAGE assignment; https://variance-authority.dev/agents/live-run'
      : undefined,
    subject.eyes === undefined
      ? '  Eyes attention — compose the Eyes adapter, author AAA phase markers, and retain journals under stable test ids; https://variance-authority.dev/reference/packages/eyes'
      : undefined,
    subject.scenarios === undefined
      ? '  scenario AAA — record host-produced snapshots and authored Acts with `@variance-authority/scenario`; https://variance-authority.dev/reference/packages/scenario'
      : undefined,
  ].filter((entry): entry is string => entry !== undefined);
  return missing.length === 0 ? [] : ['', 'To supply missing evidence:', ...missing];
}
