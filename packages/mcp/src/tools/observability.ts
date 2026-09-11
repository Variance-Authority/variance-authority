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
