// compass: variance-authority/runtime/attention
import type {
  Attention,
  EyesArchive,
  EyesPhase,
  EyesTestAttention,
  TargetSnapshot,
} from '@variance-authority/eyes';
import type {
  ExecutionIndex,
} from '@variance-authority/sense/test-selection';

type Phase = EyesPhase | 'unphased';
type OwnerPath = Extract<TargetSnapshot['provenance'], { status: 'resolved' }>['provenance']['owners'];
type CommitAttention = Extract<Attention, { kind: 'react-commit' }>;
type Updater = NonNullable<CommitAttention['commit']['updaters']>[number];

export interface DistillInput {
  readonly test: string;
  readonly eyes?: EyesArchive;
  readonly execution?: ExecutionIndex;
}

export interface AddressedPhase {
  readonly phase: Phase;
  readonly components: readonly string[];
  readonly files: readonly string[];
}

export interface UpdatePhase {
  readonly phase: Phase;
  readonly commits: number;
  readonly unavailable: number;
  readonly inside: readonly string[];
  readonly outside: readonly string[];
}

export interface EnteredFile {
  readonly file: string;
  readonly distance: number;
}

/** The portable deterministic reading shared by the CLI and MCP adapters. */
export interface Distillation {
  readonly test: { readonly id: string; readonly title: string; readonly file?: string };
  readonly attention?: {
    readonly complete: boolean;
    readonly because?: string;
    readonly targets: number;
    readonly withoutFiber: number;
    readonly phases: readonly AddressedPhase[];
    readonly updates: readonly UpdatePhase[];
  };
  readonly execution?: {
    readonly joined: boolean;
    readonly entered: readonly EnteredFile[];
    /** Absent when Eyes did not supply the addressed side of the comparison. */
    readonly opportunities?: readonly EnteredFile[];
  };
}

interface MutableAddressed {
  readonly owners: Set<string>;
  readonly files: Set<string>;
  readonly paths: OwnerPath[];
}

interface MutableUpdates {
  commits: number;
  unavailable: number;
  readonly updaters: Updater[];
}

const PHASES = ['unphased', 'arrange', 'act', 'assert'] as const;

/** Distil supplied observations into deterministic reduction opportunities. */
export function distill(input: DistillInput): Distillation {
  const eyesTest = input.eyes === undefined ? undefined : locateEyesTest(input.eyes, input.test);
  const executionTest = locateExecutionTest(input.execution, input.test, eyesTest?.id);
  if (eyesTest === undefined && executionTest === undefined) {
    throw new Error(`no supplied evidence contains test ${input.test}`);
  }

  const identity = eyesTest ?? executionTest!;
  const attention = eyesTest === undefined ? undefined : attentionOf(eyesTest);
  const addressed = attention === undefined
    ? undefined
    : new Set(attention.phases.flatMap((phase) => phase.files));
  const execution = input.execution === undefined
    ? undefined
    : executionOf(input.execution, identity.id, addressed);
  return {
    test: {
      id: identity.id,
      title: 'title' in identity ? identity.title : identity.name,
      ...(identity.file === undefined ? {} : { file: identity.file }),
    },
    ...(attention === undefined ? {} : { attention }),
    ...(execution === undefined ? {} : { execution }),
  };
}

function locateEyesTest(archive: EyesArchive, asked: string): EyesTestAttention | undefined {
  const byId = archive.tests.find((test) => test.id === asked);
  if (byId !== undefined) return byId;
  const exact = archive.tests.filter((test) => test.title === asked);
  if (exact.length === 1) return exact[0];
  const partial = archive.tests.filter((test) =>
    test.title.toLowerCase().includes(asked.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(`${partial.length} Eyes tests match ${asked}; use a stable test id`);
  }
  return undefined;
}

function locateExecutionTest(
  index: ExecutionIndex | undefined,
  asked: string,
  eyesId: string | undefined,
): ExecutionIndex['tests'][number] | undefined {
  if (index === undefined) return undefined;
  const id = eyesId ?? asked;
  return index.tests.find((test) => test.id === id);
}

function attentionOf(test: EyesTestAttention): NonNullable<Distillation['attention']> {
  const addressed = new Map<Phase, MutableAddressed>();
  const updates = new Map<Phase, MutableUpdates>();
  let phase: Phase = 'unphased';
  let targets = 0;
  let withoutFiber = 0;
  for (const entry of test.attention) {
    if (entry.kind === 'eyes-phase') phase = entry.phase;
    if (entry.kind === 'react-commit') addCommit(updates, phase, entry);
    for (const target of targetsOf(entry)) {
      targets += 1;
      const bucket = addressed.get(phase) ?? { owners: new Set(), files: new Set(), paths: [] };
      addressed.set(phase, bucket);
      if (target.provenance.status === 'no-fiber') withoutFiber += 1;
      else addTarget(bucket, target);
    }
  }
  return {
    complete: test.complete,
    ...(!test.complete ? { because: test.because } : {}),
    targets,
    withoutFiber,
    phases: PHASES.flatMap((name) => {
      const found = addressed.get(name);
      return found === undefined ? [] : [{
        phase: name,
        components: sorted(found.owners),
        files: sorted(found.files),
      }];
    }),
    updates: updatePhases(updates, addressed),
  };
}

function addCommit(
  updates: Map<Phase, MutableUpdates>,
  phase: Phase,
  entry: CommitAttention,
): void {
  const bucket = updates.get(phase) ?? { commits: 0, unavailable: 0, updaters: [] };
  bucket.commits += 1;
  if (entry.commit.updaters === undefined) bucket.unavailable += 1;
  else bucket.updaters.push(...entry.commit.updaters);
  updates.set(phase, bucket);
}

function addTarget(bucket: MutableAddressed, target: TargetSnapshot): void {
  if (target.provenance.status !== 'resolved') return;
  const provenance = target.provenance.provenance;
  bucket.paths.push(provenance.owners);
  for (const owner of provenance.owners) bucket.owners.add(owner.name);
  if (provenance.createdBy !== undefined) bucket.owners.add(provenance.createdBy);
  if (provenance.source !== undefined) bucket.files.add(provenance.source.file);
}

function targetsOf(entry: Attention): readonly TargetSnapshot[] {
  if (entry.kind === 'rtl-query' && entry.outcome === 'resolved') return entry.targets;
  if (entry.kind === 'document-event') return [entry.target];
  if (entry.kind === 'playwright-locator' && entry.operation !== 'planned') {
    return [...(entry.before ?? []), ...(entry.outcome === 'resolved' ? entry.after ?? [] : [])];
  }
  return [];
}

function updatePhases(
  updates: ReadonlyMap<Phase, MutableUpdates>,
  addressed: ReadonlyMap<Phase, MutableAddressed>,
): readonly UpdatePhase[] {
  return PHASES.flatMap((phase) => {
    const found = updates.get(phase);
    if (found === undefined) return [];
    const paths = addressed.get(phase)?.paths ?? [];
    const inside = found.updaters.filter((updater) =>
      paths.some((path) => pathsOverlap(updater, path)));
    const outside = found.updaters.filter((updater) => !inside.includes(updater));
    return [{
      phase,
      commits: found.commits,
      unavailable: found.unavailable,
      inside: sorted(inside.map(updaterName)),
      outside: sorted(outside.map(updaterName)),
    }];
  });
}

function pathsOverlap(updater: Updater, target: OwnerPath): boolean {
  const length = Math.min(updater.path.length, target.length);
  for (let offset = 1; offset <= length; offset += 1) {
    const left = updater.path[updater.path.length - offset]!;
    const right = target[target.length - offset]!;
    if (left.name !== right.name || left.propsDigest !== right.propsDigest) return false;
  }
  return length > 0;
}

function updaterName(updater: Updater): string {
  return updater.path.map((frame) => frame.name).join(' ← ');
}

function executionOf(
  index: ExecutionIndex,
  id: string,
  addressed: ReadonlySet<string> | undefined,
): NonNullable<Distillation['execution']> {
  const test = index.tests.findIndex((candidate) => candidate.id === id);
  if (test < 0) return { joined: false, entered: [], opportunities: [] };
  const entered = index.modules.flatMap((module) => enteredFile(module, test))
    .sort((left, right) => left.distance - right.distance || compare(left.file, right.file));
  return {
    joined: true,
    entered,
    ...(addressed === undefined
      ? {}
      : { opportunities: entered.filter(({ file }) => !addressed.has(file)) }),
  };
}

function enteredFile(
  module: ExecutionIndex['modules'][number],
  test: number,
): readonly EnteredFile[] {
  const distances = module.blocks.flatMap((block) => block.crossings
    .filter((crossing) => crossing.test === test)
    .map((crossing) => crossing.distance));
  return distances.length === 0 ? [] : [{ file: module.file, distance: Math.min(...distances) }];
}

/** Render a distillation for a person or agent. */
export function formatDistillation(result: Distillation): string {
  const attention = result.attention;
  const execution = result.execution;
  return [
    `${result.test.title} — ${result.test.file ?? 'file not supplied'} [${result.test.id}]`,
    ...(attention === undefined ? ['Eyes attention: unavailable.'] : [
      attention.complete ? 'Eyes journal: complete.' : `Eyes journal: partial — ${attention.because}`,
      `${attention.targets} target snapshot(s); ${attention.withoutFiber} had no live React Fiber.`,
      '',
      ...(attention.phases.length === 0 ? ['Addressed surface: measured empty.'] : attention.phases.flatMap((phase) => [
        `${phase.phase}:`,
        `  components: ${values(phase.components, 'none attributed by Eyes')}`,
        `  source: ${values(phase.files, 'none attributed by Eyes')}`,
      ])),
      '',
      ...updateLines(attention.updates),
    ]),
    '',
    ...executionLines(execution, result.test.id),
    '',
    'Opportunity rule: an entered file with no addressed target attribution is a distillation ' +
      'opportunity only. The evidence does not establish that it is safe to mock, replace, or remove.',
  ].join('\n');
}

function updateLines(updates: readonly UpdatePhase[]): readonly string[] {
  if (updates.length === 0) return ['React update initiators: unavailable; no commit evidence was recorded.'];
  return ['React update initiators:', ...updates.flatMap((phase) => [
    `  ${phase.phase}: ${phase.commits} commit(s)`,
    ...(phase.unavailable === 0 ? [] : [`    unavailable in ${phase.unavailable} commit(s)`]),
    ...(phase.inside.length === 0 ? [] : [`    inside addressed component paths: ${phase.inside.join('; ')}`]),
    ...(phase.outside.length === 0 ? [] : [`    outside addressed component paths: ${phase.outside.join('; ')}`]),
    ...(phase.inside.length === 0 && phase.outside.length === 0 && phase.unavailable < phase.commits
      ? ['    measured empty'] : []),
  ])];
}

function executionLines(execution: Distillation['execution'], id: string): readonly string[] {
  if (execution === undefined) {
    return ['Runtime journey: unavailable; no entered-versus-addressed comparison was made.'];
  }
  if (!execution.joined) return [
    `Runtime journey: supplied, but it contains no test with exact id ${id}.`,
    'No title or file join was guessed.',
  ];
  return [
    'Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.',
    `Runtime journey: ${execution.entered.length} source file(s) entered by exact test id.`,
    ...(execution.entered.length === 0 ? ['  measured empty'] : execution.entered.map(({ file, distance }) =>
      `  depth ${distance} — ${file}`)),
    ...(execution.opportunities === undefined
      ? ['Distillation opportunities: unavailable; Eyes attention was not supplied.']
      : [
          `Entered with no addressed target attributed to the same file: ${execution.opportunities.length}.`,
          ...execution.opportunities.map(({ file, distance }) =>
            `  distillation opportunity at depth ${distance} — ${file}`),
        ]),
  ];
}

/** Validate the runner-independent execution JSON accepted by the CLI. */
export function parseExecutionIndex(value: unknown): ExecutionIndex {
  const root = object(value, 'execution index');
  if (!Array.isArray(root['tests']) || !Array.isArray(root['modules'])) {
    throw new Error('execution index tests and modules must be arrays');
  }
  const tests = root['tests'].map((value, at) => {
    const test = object(value, `execution test ${at}`);
    return {
      id: string(test['id'], `execution test ${at} id`),
      file: string(test['file'], `execution test ${at} file`),
      name: string(test['name'], `execution test ${at} name`),
    };
  });
  const modules = root['modules'].map((value, at) => {
    const module = object(value, `execution module ${at}`);
    if (!Array.isArray(module['blocks'])) throw new Error(`execution module ${at} blocks must be an array`);
    return {
      file: string(module['file'], `execution module ${at} file`),
      blocks: module['blocks'].map((value, blockAt) => parseBlock(value, at, blockAt, tests.length)),
    };
  });
  return { tests, modules };
}

function parseBlock(
  value: unknown,
  moduleAt: number,
  at: number,
  tests: number,
): ExecutionIndex['modules'][number]['blocks'][number] {
  const where = `execution module ${moduleAt} block ${at}`;
  const block = object(value, where);
  if (!Array.isArray(block['crossings'])) throw new Error(`${where} crossings must be an array`);
  const startLine = integer(block['startLine'], `${where} startLine`);
  const endLine = integer(block['endLine'], `${where} endLine`);
  if (typeof block['source'] !== 'boolean') throw new Error(`${where} source must be boolean`);
  return {
    kind: string(block['kind'], `${where} kind`),
    name: string(block['name'], `${where} name`),
    path: string(block['path'], `${where} path`),
    startLine,
    endLine,
    source: block['source'],
    crossings: block['crossings'].map((value, crossingAt) => {
      const crossing = object(value, `${where} crossing ${crossingAt}`);
      const test = integer(crossing['test'], `${where} crossing ${crossingAt} test`, true);
      if (test >= tests) throw new Error(`${where} crossing ${crossingAt} names missing test ${test}`);
      return { test, distance: integer(crossing['distance'], `${where} crossing ${crossingAt} distance`, true) };
    }),
  };
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${where} must be a non-empty string`);
  return value;
}

function integer(value: unknown, where: string, allowZero = false): number {
  if (!Number.isInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new Error(`${where} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return value as number;
}

function values(found: readonly string[], empty: string): string {
  return found.length === 0 ? empty : found.join(', ');
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort(compare);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
