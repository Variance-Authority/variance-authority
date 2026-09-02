import type { EyesPhase, EyesTestAttention, TargetSnapshot } from '@variance-authority/eyes';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { ObservabilitySubject } from '../observability-subject.js';
import { locateEyesTest, phasedAttention, targetsOf } from './attention.js';
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

/** Join a test's addressed DOM owners to its runtime execution without calling either silence safe. */
export const testingSurface: Tool<ObservabilitySubject> = {
  name: 'variance_testing_surface',
  description:
    'Map one test’s Eyes-addressed components and source locations by AAA phase, then contrast them with its Sense runtime journey to identify replay candidates—not safe mocks.',
  inputSchema: {
    type: 'object',
    properties: {
      test: { type: 'string', description: 'An Eyes test id, exact title, or unambiguous title part.' },
    },
    required: ['test'],
    additionalProperties: false,
  },
  run(subject, input) {
    if (subject.eyes === undefined) {
      return 'Eyes attention is unavailable to this MCP connection; no testing surface can be attributed.';
    }
    const asked = stringArg(input, 'test');
    const found = locateEyesTest(subject.eyes, asked);
    if (typeof found === 'string') return found;
    return surface(found, subject.execution);
  },
};

function line(name: string, evidence: unknown, detail: string | undefined): string {
  return evidence === undefined ? `  unavailable — ${name}` : `  available   — ${name}: ${detail}`;
}

function surface(test: EyesTestAttention, execution: ExecutionIndex | undefined): string {
  const phases = new Map<EyesPhase | 'unphased', { owners: Set<string>; files: Set<string> }>();
  let unattributed = 0;
  let targets = 0;
  for (const { phase, entry } of phasedAttention(test.attention)) {
    for (const target of targetsOf(entry)) {
      targets += 1;
      const bucket = phases.get(phase) ?? { owners: new Set(), files: new Set() };
      phases.set(phase, bucket);
      if (target.provenance.status === 'no-fiber') {
        unattributed += 1;
        continue;
      }
      addTarget(bucket, target);
    }
  }

  const addressedFiles = new Set([...phases.values()].flatMap((phase) => [...phase.files]));
  const executionLines = executionSurface(execution, test, addressedFiles);
  return [
    `${test.title} — ${test.file ?? 'file not supplied'} [${test.id}]`,
    test.complete ? 'Eyes journal: complete.' : `Eyes journal: partial — ${test.because}`,
    `${targets} target snapshot(s); ${unattributed} had no live React Fiber.`,
    '',
    ...phaseLines(phases),
    '',
    ...executionLines,
    '',
    'Reduction rule: an executed file with no addressed target attribution is a replay candidate only. ' +
      'Neither Eyes nor Sense establishes that it is safe to mock.',
  ].join('\n');
}

function addTarget(
  bucket: { owners: Set<string>; files: Set<string> },
  target: TargetSnapshot,
): void {
  if (target.provenance.status !== 'resolved') return;
  const provenance = target.provenance.provenance;
  for (const owner of provenance.owners) bucket.owners.add(owner.name);
  if (provenance.createdBy !== undefined) bucket.owners.add(provenance.createdBy);
  if (provenance.source !== undefined) bucket.files.add(provenance.source.file);
}

function phaseLines(
  phases: ReadonlyMap<EyesPhase | 'unphased', { owners: Set<string>; files: Set<string> }>,
): string[] {
  if (phases.size === 0) return ['Addressed surface: measured empty.'];
  const order = ['unphased', 'arrange', 'act', 'assert'] as const;
  return order.flatMap((phase) => {
    const found = phases.get(phase);
    if (found === undefined) return [];
    return [
      `${phase}:`,
      `  components: ${values(found.owners)}`,
      `  source: ${values(found.files)}`,
    ];
  });
}

function executionSurface(
  index: ExecutionIndex | undefined,
  test: EyesTestAttention,
  addressed: ReadonlySet<string>,
): string[] {
  if (index === undefined) {
    return ['Runtime journey: unavailable; no executed-versus-addressed comparison was made.'];
  }
  const testIndex = index.tests.findIndex((candidate) => candidate.id === test.id);
  if (testIndex < 0) {
    return [
      `Runtime journey: supplied, but it contains no test with exact id ${test.id}.`,
      'No title or file join was guessed.',
    ];
  }
  const files = index.modules.flatMap((module) => {
    const distances = module.blocks.flatMap((block) =>
      block.crossings.filter((crossing) => crossing.test === testIndex).map((crossing) => crossing.distance));
    return distances.length === 0 ? [] : [{ file: module.file, distance: Math.min(...distances) }];
  }).sort((left, right) => left.distance - right.distance || compare(left.file, right.file));
  const candidates = files.filter(({ file }) => !addressed.has(file));
  return [
    'Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.',
    `Runtime journey: ${files.length} source file(s) entered by exact test id.`,
    ...(files.length === 0 ? ['  measured empty'] : files.map(({ file, distance }) => `  depth ${distance} — ${file}`)),
    `Executed with no addressed target attributed to the same file: ${candidates.length}.`,
    ...candidates.map(({ file, distance }) => `  replay candidate at depth ${distance} — ${file}`),
  ];
}

function values(found: ReadonlySet<string>): string {
  return found.size === 0 ? 'none attributed by Eyes' : [...found].sort(compare).join(', ');
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
