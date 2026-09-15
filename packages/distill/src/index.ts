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

/** One instrumented region of an entered module, as this test met it. */
export interface Region {
  readonly kind: string;
  /** Declaration name path. Empty on the module root. */
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Shortest observed depth. Absent when this test never crossed the region. */
  readonly distance?: number;
}

/**
 * One entered module, read region by region.
 *
 * {@link EnteredFile} answers whether a test was ever inside a file, which is
 * the question test selection asks and the one it must over-answer. This
 * answers which parts of the file the test was inside, which is the opposite
 * direction, and the two are not the same reading of the same evidence.
 */
export interface EnteredModule {
  readonly file: string;
  /** Shortest observed depth to any crossed region. */
  readonly distance: number;
  /**
   * True when every crossing this test has in the module is a consequence of
   * loading it: the module root, or a region a producer marked `loaded`.
   *
   * The import ran the module's top level and nothing else in the file was
   * entered. `import { A } from './B'` where `A` is never called reads exactly
   * like this, whether the call site was replaced by a spy or a branch never
   * chose it.
   */
  readonly loadedOnly: boolean;
  /** Regions the test called into, nearest first. */
  readonly entered: readonly Region[];
  /** Regions the test never crossed, outermost declarations only, in source order. */
  readonly unentered: readonly Region[];
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
    /** The same crossings read region by region, in the order of `entered`. */
    readonly modules: readonly EnteredModule[];
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

export { formatDistillation } from './format.js';
export { parseExecutionIndex } from './execution-json.js';

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
  if (test < 0) return { joined: false, entered: [], opportunities: [], modules: [] };
  const modules = index.modules.flatMap((module) => enteredModule(module, test))
    .sort((left, right) => left.distance - right.distance || compare(left.file, right.file));
  const entered = modules.map(({ file, distance }) => ({ file, distance }));
  return {
    joined: true,
    entered,
    ...(addressed === undefined
      ? {}
      : { opportunities: entered.filter(({ file }) => !addressed.has(file)) }),
    modules,
  };
}

type Block = ExecutionIndex['modules'][number]['blocks'][number];

/**
 * Whether a crossing says the module was loaded rather than exercised.
 *
 * A module root has no caller a test could be: reaching it means the import
 * ran, and nothing more. `loaded` is the same fact from a producer that can
 * also see it for a region below the root — a function the top level called.
 * Both are derived here rather than asked of the producer, so an index that
 * only reports regions and crossings still answers the question.
 */
function loadedCrossing(block: Block, crossing: Block['crossings'][number]): boolean {
  return crossing.loaded === true || block.kind === 'module';
}

function enteredModule(
  module: ExecutionIndex['modules'][number],
  test: number,
): readonly EnteredModule[] {
  const crossed: { block: Block; distance: number; loaded: boolean }[] = [];
  const missed: Block[] = [];
  for (const block of module.blocks) {
    const mine = block.crossings.filter((crossing) => crossing.test === test);
    if (mine.length === 0) {
      if (block.source) missed.push(block);
      continue;
    }
    crossed.push({
      block,
      distance: Math.min(...mine.map((crossing) => crossing.distance)),
      loaded: mine.every((crossing) => loadedCrossing(block, crossing)),
    });
  }
  if (crossed.length === 0) return [];
  return [{
    file: module.file,
    distance: Math.min(...crossed.map(({ distance }) => distance)),
    loadedOnly: crossed.every(({ loaded }) => loaded),
    entered: crossed
      .filter(({ loaded }) => !loaded)
      .sort((left, right) => left.distance - right.distance || left.block.startLine - right.block.startLine)
      .map(({ block, distance }) => ({ ...regionOf(block), distance })),
    unentered: outermost(missed).map(regionOf),
  }];
}

/**
 * The declarations of a module that this test never reached.
 *
 * Only whole declarations, and only the outermost ones: a branch nobody took
 * inside a function nobody called is the same fact said twice, and a branch
 * inside a function the test did enter is a path through behavior the test
 * exercises rather than a boundary it could be given.
 */
function outermost(missed: readonly Block[]): readonly Block[] {
  const declarations = missed.filter((block) => block.kind === 'function');
  return declarations
    .filter((block) => !declarations.some((other) => other !== block && encloses(other, block)))
    .sort((left, right) => left.startLine - right.startLine || compare(left.name, right.name));
}

function encloses(outer: Block, inner: Block): boolean {
  return (
    outer.startLine <= inner.startLine &&
    outer.endLine >= inner.endLine &&
    (outer.startLine !== inner.startLine || outer.endLine !== inner.endLine)
  );
}

function regionOf(block: Block): Region {
  const { kind, name, path, startLine, endLine } = block;
  return { kind, name, path, startLine, endLine };
}


function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort(compare);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
