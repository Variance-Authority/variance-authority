// compass: variance-authority/runtime/attention
import type {
  Attention,
  EyesJournal,
  EyesPhase,
  TargetSnapshot,
} from '@variance-authority/eyes';
import type {
  ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { attribute } from './attribution.js';

type Phase = EyesPhase | 'unphased';
type OwnerPath = Extract<TargetSnapshot['provenance'], { status: 'resolved' }>['provenance']['owners'];
type CommitAttention = Extract<Attention, { kind: 'react-commit' }>;
type Updater = NonNullable<CommitAttention['commit']['updaters']>[number];

/** One case's Eyes journal for one attempt, as the record keeps it. */
export interface EyesAttempt {
  /** The case, by the id the record's case index gives it. */
  readonly case: string;
  /** Which run of the case this is, counted from 1. A retry is attempt 2. */
  readonly attempt: number;
  readonly journal: EyesJournal;
}

export interface DistillInput {
  /** The case id, exactly as the record's case index spells it. */
  readonly test: string;
  /** The record's case index: the cases, and the regions each one crossed. */
  readonly execution: ExecutionIndex;
  /**
   * Every Eyes journal the record keeps. Absent when the run did not opt into
   * Eyes, which is not the same reading as a case that addressed nothing.
   */
  readonly eyes?: readonly EyesAttempt[];
  /**
   * The cases whose test opened an Eyes journal, handed over or not. Absent
   * when the record does not say, and then every case of a run with Eyes is
   * read as watched.
   */
  readonly watched?: readonly string[];
  /**
   * The root both sides' paths are relative to. A record names every path
   * against the checkout, so it is needed only for evidence that names a
   * source absolutely.
   */
  readonly root?: string;
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
   *
   * False when the module declares nothing below its top level — constants, a
   * barrel of re-exports: loading it ran everything it has, so there is no
   * declaration the test left alone and nothing for a mock to take away.
   */
  readonly loadedOnly: boolean;
  /** Regions the test called into, nearest first. */
  readonly entered: readonly Region[];
  /** Regions the test never crossed, outermost declarations only, in source order. */
  readonly unentered: readonly Region[];
}

/** What one attempt of a case addressed, read from its Eyes journal. */
export interface AttemptAttention {
  /** Which run of the case this is, counted from 1. */
  readonly attempt: number;
  readonly complete: boolean;
  readonly because?: string;
  readonly targets: number;
  readonly withoutFiber: number;
  readonly phases: readonly AddressedPhase[];
  readonly updates: readonly UpdatePhase[];
}

/** The portable deterministic reading shared by the CLI and MCP adapters. */
export interface Distillation {
  readonly test: { readonly id: string; readonly title: string; readonly file?: string };
  /**
   * The case's attempts, in order. Absent when the record keeps no Eyes
   * journal; empty when it keeps journals and none for this case.
   */
  readonly attempts?: readonly AttemptAttention[];
  readonly execution: {
    readonly entered: readonly EnteredFile[];
    /** Absent when the entered-versus-addressed comparison was not made. */
    readonly opportunities?: readonly EnteredFile[];
    /** Present exactly when `opportunities` is absent: what stopped the comparison. */
    readonly withheld?: string;
    /**
     * Addressed source files that matched no entered module, in the shape the
     * comparison used. A long list here says the two sides are rooted
     * differently even though enough of them met for the join to stand.
     */
    readonly addressedNotEntered?: readonly string[];
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

/**
 * How many recorded ids a refusal shows.
 *
 * Enough for a reader to see the shape their own id should have had, and few
 * enough that an index of four thousand cases does not answer with four
 * thousand lines.
 */
const AVAILABLE_SHOWN = 5;

/**
 * Distil one case's record into deterministic reduction opportunities.
 *
 * The case is found by its exact id and nothing else: a title or a file is not
 * a case, and an id the index does not hold is refused with the ids it does.
 * Each attempt is read on its own, and a file any attempt addressed counts as
 * addressed, so a retry that touched a component is never told it could lose it.
 */
export function distill(input: DistillInput): Distillation {
  const test = input.execution.tests.findIndex((candidate) => candidate.id === input.test);
  if (test < 0) throw new Error(unresolved(input.execution, input.test));
  const identity = input.execution.tests[test]!;
  const attempts = input.eyes
    ?.filter((row) => row.case === identity.id)
    .sort((left, right) => left.attempt - right.attempt)
    .map((row) => attentionOf(row.attempt, row.journal));
  const addressed = attempts === undefined
    ? undefined
    : new Set(attempts.flatMap((attempt) => attempt.phases.flatMap((phase) => phase.files)));
  return {
    test: {
      id: identity.id,
      title: identity.name,
      ...(identity.file === undefined ? {} : { file: identity.file }),
    },
    ...(attempts === undefined ? {} : { attempts }),
    execution: executionOf(
      input.execution,
      test,
      attempts,
      addressed,
      input.root,
      input.watched === undefined || input.watched.includes(identity.id),
    ),
  };
}

/**
 * The refusal for an id the index does not hold, showing the ids it does.
 *
 * Naming only the missing id leaves nothing to compare it against, and the
 * usual cause is an id spelled some other way. A handful of recorded ids shows
 * the shape in one glance, and an index of thousands answers in a few lines.
 */
function unresolved(index: ExecutionIndex, asked: string): string {
  const total = index.tests.length;
  if (total === 0) return `The record holds no case with id ${asked}: it records no cases at all.`;
  const shown = index.tests.slice(0, AVAILABLE_SHOWN).map((candidate) => `  ${candidate.id}`);
  return [
    `The record holds no case with id ${asked}. No title or file join was guessed.`,
    `It records ${total} case id(s), of which:`,
    ...shown,
    ...(total > shown.length ? [`  and ${total - shown.length} more.`] : []),
    'A case id is `<repository-relative file> > <describe path and name>`, exactly.',
  ].join('\n');
}

function attentionOf(attempt: number, test: EyesJournal): AttemptAttention {
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
    attempt,
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
  test: number,
  attempts: readonly AttemptAttention[] | undefined,
  addressed: ReadonlySet<string> | undefined,
  root: string | undefined,
  watched: boolean,
): Distillation['execution'] {
  const modules = index.modules.flatMap((module) => enteredModule(module, test))
    .sort((left, right) => left.distance - right.distance || compare(left.file, right.file));
  const entered = modules.map(({ file, distance }) => ({ file, distance }));
  return {
    entered,
    ...opportunitiesOf(entered, attempts, addressed, root, watched),
    modules,
  };
}

/**
 * The opportunity list, or the reason there is none.
 *
 * An entered file with no addressed target attributed to it is the whole
 * finding, so a list produced from a join that did not hold is worse than no
 * list: it is the same sentence, said confidently, about every entered file.
 * Both withholding branches therefore carry what could not be established, and
 * `format.ts` prints it where the list would have gone.
 */
function opportunitiesOf(
  entered: readonly EnteredFile[],
  attempts: readonly AttemptAttention[] | undefined,
  addressed: ReadonlySet<string> | undefined,
  root: string | undefined,
  watched: boolean,
): Pick<
  Distillation['execution'],
  'opportunities' | 'withheld' | 'addressedNotEntered'
> {
  if (attempts === undefined || addressed === undefined) {
    return { withheld: 'the record keeps no Eyes journals; the run did not opt into Eyes.' };
  }
  if (attempts.length === 0) {
    return { withheld: watched ? 'the record keeps no Eyes journal for this case.' : 'this case\'s run did not opt into Eyes.' };
  }
  const attribution = attribute(root, entered.map(({ file }) => file), addressed);
  if (!attribution.joined) return { withheld: attribution.because };
  return {
    opportunities: entered.filter(({ file }) => !attribution.addressed.has(attribution.key(file))),
    ...(attribution.notEntered.length === 0 ? {} : { addressedNotEntered: attribution.notEntered }),
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
  const unentered = outermost(missed).map(regionOf);
  return [{
    file: module.file,
    distance: Math.min(...crossed.map(({ distance }) => distance)),
    loadedOnly: unentered.length > 0 && crossed.every(({ loaded }) => loaded),
    entered: crossed
      .filter(({ loaded }) => !loaded)
      .sort((left, right) => left.distance - right.distance || left.block.startLine - right.block.startLine)
      .map(({ block, distance }) => ({ ...regionOf(block), distance })),
    unentered,
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
