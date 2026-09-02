import type {
  Attention,
  EyesArchive,
  EyesPhase,
  EyesTestAttention,
  LocatorStep,
  TargetSnapshot,
} from '@variance-authority/eyes';
import { stringArg, type Tool } from './tool.js';

type Phase = EyesPhase | 'unphased';

/** Test attention in authored AAA order, with selectors and attributed targets. */
export const attention: Tool<EyesArchive> = {
  name: 'variance_test_attention',
  description:
    'List Eyes-instrumented tests, or explain one test’s selectors, Locator consumption, DOM events, and authored Arrange/Act/Assert boundaries in order.',
  inputSchema: {
    type: 'object',
    properties: {
      test: { type: 'string', description: 'A test id, exact title, or unambiguous title part.' },
      phase: { enum: ['arrange', 'act', 'assert'], description: 'Optional authored AAA phase.' },
    },
    additionalProperties: false,
  },
  run(archive, input) {
    if (input['test'] === undefined) return listing(archive);
    const found = locate(archive, stringArg(input, 'test'));
    if (typeof found === 'string') return found;
    const phase = optionalPhase(input);
    const lines = attentionLines(found.attention, phase);
    return [
      `${found.title} — ${found.file ?? 'file not supplied'} [${found.id}]`,
      found.complete ? 'Attention journal: complete.' : `Attention journal: partial — ${found.because}`,
      ...(phase === undefined ? [] : [`Authored phase: ${phase}.`]),
      '',
      ...(lines.length === 0
        ? [`No attention was recorded${phase === undefined ? '' : ` in ${phase}`}.`]
        : lines),
    ].join('\n');
  },
};

export function locateEyesTest(archive: EyesArchive, asked: string): EyesTestAttention | string {
  const byId = archive.tests.find((test) => test.id === asked);
  if (byId !== undefined) return byId;
  const exact = archive.tests.filter((test) => test.title === asked);
  if (exact.length === 1) return exact[0]!;
  const lowered = asked.toLowerCase();
  const partial = archive.tests.filter((test) => test.title.toLowerCase().includes(lowered));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) return `No Eyes test matches ${asked}. ${archive.tests.length} test(s) are recorded.`;
  return `${partial.length} Eyes tests match ${asked}; ask by id:\n${partial.map((test) => `  ${test.title} [${test.id}]`).join('\n')}`;
}

export function phasedAttention(entries: readonly Attention[]): readonly { phase: Phase; entry: Attention }[] {
  let phase: Phase = 'unphased';
  const phased: { phase: Phase; entry: Attention }[] = [];
  for (const entry of entries) {
    if (entry.kind === 'eyes-phase') phase = entry.phase;
    phased.push({ phase, entry });
  }
  return phased;
}

export function targetsOf(entry: Attention): readonly TargetSnapshot[] {
  if (entry.kind === 'rtl-query' && entry.outcome === 'resolved') return entry.targets;
  if (entry.kind === 'document-event') return [entry.target];
  if (entry.kind === 'playwright-locator' && entry.operation !== 'planned') {
    return [...(entry.before ?? []), ...(entry.outcome === 'resolved' ? entry.after ?? [] : [])];
  }
  return [];
}

function listing(archive: EyesArchive): string {
  if (archive.tests.length === 0) return 'Eyes measured an archive containing no tests.';
  return [
    `${archive.tests.length} Eyes test(s):`,
    ...archive.tests.map((test) =>
      `  ${test.complete ? 'complete' : 'partial'} — ${test.title} — ${test.file ?? 'file not supplied'} [${test.id}]`),
  ].join('\n');
}

function locate(archive: EyesArchive, asked: string): EyesTestAttention | string {
  return locateEyesTest(archive, asked);
}

function optionalPhase(input: Readonly<Record<string, unknown>>): EyesPhase | undefined {
  const value = input['phase'];
  if (value === undefined) return undefined;
  if (value !== 'arrange' && value !== 'act' && value !== 'assert') {
    throw new Error('`phase` must be arrange, act, or assert');
  }
  return value;
}

function attentionLines(entries: readonly Attention[], only: EyesPhase | undefined): string[] {
  return phasedAttention(entries)
    .filter(({ phase }) => only === undefined || phase === only)
    .map(({ phase, entry }) => `#${entry.sequence} [${phase}] ${describe(entry)}`);
}

function describe(entry: Attention): string {
  if (entry.kind === 'eyes-phase') return `phase → ${entry.phase}`;
  if (entry.kind === 'document-event') {
    return `document ${entry.event}${entry.trusted ? '' : ' (synthetic)'} → ${targetLine(entry.target)}`;
  }
  if (entry.kind === 'rtl-query') {
    const call = `${entry.query}(${argumentsLine(entry.arguments)})`;
    if (entry.outcome === 'threw') return `${call} threw ${entry.error}`;
    if (entry.outcome === 'absent') return `${call} → absent`;
    return `${call} → ${targetList(entry.targets)}`;
  }
  const locator = locatorLine(entry.locator);
  if (entry.operation === 'planned') return `planned ${locator}`;
  if (entry.outcome === 'threw') return `${entry.operation} ${entry.member} on ${locator} threw ${entry.error}`;
  return `${entry.operation} ${entry.member} on ${locator} — before ${targetList(entry.before ?? [])}; after ${targetList(entry.after ?? [])}`;
}

function locatorLine(steps: readonly LocatorStep[]): string {
  return steps.map((step) => `${step.member}(${argumentsLine(step.arguments)})`).join('.');
}

function argumentsLine(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join(', ');
}

function targetList(targets: readonly TargetSnapshot[]): string {
  return targets.length === 0 ? '0 targets' : targets.map(targetLine).join('; ');
}

function targetLine(target: TargetSnapshot): string {
  const identity = [
    target.nodeName,
    target.role === undefined ? undefined : `role=${target.role}`,
    target.ariaLabel === undefined ? undefined : `name=${JSON.stringify(target.ariaLabel)}`,
    target.id === undefined ? undefined : `#${target.id}`,
  ].filter((part): part is string => part !== undefined).join(' ');
  if (target.provenance.status === 'no-fiber') return `${identity} [no Fiber: ${target.provenance.reason}]`;
  const provenance = target.provenance.provenance;
  const owners = provenance.owners.map((owner) => owner.name).join(' ← ') || 'React root';
  const source = provenance.source === undefined
    ? ''
    : ` at ${provenance.source.file}:${provenance.source.line}`;
  return `${identity} [${owners}${source}]`;
}
