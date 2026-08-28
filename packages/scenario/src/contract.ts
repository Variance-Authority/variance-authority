import type {
  Band,
  Diagnostic,
  Digest,
  PartingSlice,
  ProfileId,
  SemanticSnapshot,
  SubjectRef,
} from '@variance-authority/core';

const scenarioToken: unique symbol = Symbol('checked scenario value');

export interface ScenarioDefinitionData {
  readonly scenarioVersion: 1;
  readonly id: string;
  readonly acts: readonly ScenarioAct[];
}

/** A definition checked and created by `defineScenario`. */
export class ScenarioDefinition implements ScenarioDefinitionData {
  declare private readonly checked: true;
  readonly scenarioVersion = 1 as const;
  readonly id: string;
  readonly acts: readonly ScenarioAct[];

  constructor(token: typeof scenarioToken, value: ScenarioDefinitionData) {
    if (token !== scenarioToken) throw new Error('ScenarioDefinition is constructor-owned');
    this.id = value.id;
    this.acts = value.acts.map((act) => Object.freeze({ ...act }));
    Object.freeze(this);
  }
}

export interface ScenarioAct {
  /** Stable authored identity. A DOM event or resolved target is evidence, not identity. */
  readonly key: string;
  readonly kind?: string;
}

export interface PreconditionAxisStep {
  readonly axis: string;
  readonly from: string;
  readonly to: string;
}

/** The result of the existing subject-parent resolver, carried rather than re-parsed. */
export type PreconditionLink =
  | {
      readonly kind: 'resolved';
      readonly parent: string;
      readonly how: 'declared' | 'named';
      readonly step?: PreconditionAxisStep;
    }
  | { readonly kind: 'unresolved'; readonly because: string };

export interface ScenarioExecutionData {
  readonly executionVersion: 1;
  readonly id: string;
  readonly definition: string;
  readonly precondition: SubjectRef;
  readonly preconditionLink?: PreconditionLink;
  readonly profile: ProfileId;
  readonly frames: readonly ScenarioFrame[];
  readonly termination?: readonly Diagnostic[];
}

/** An execution whose frame ordering, Act identities, and terminal prefix are checked. */
export class ScenarioExecution implements ScenarioExecutionData {
  declare private readonly checked: true;
  readonly executionVersion = 1 as const;
  readonly id: string;
  readonly definition: string;
  readonly precondition: SubjectRef;
  readonly preconditionLink?: PreconditionLink;
  readonly profile: ProfileId;
  readonly frames: readonly ScenarioFrame[];
  readonly termination?: readonly Diagnostic[];

  constructor(token: typeof scenarioToken, value: ScenarioExecutionData) {
    if (token !== scenarioToken) throw new Error('ScenarioExecution is constructor-owned');
    this.id = value.id;
    this.definition = value.definition;
    this.precondition = Object.freeze({ ...value.precondition });
    if (value.preconditionLink !== undefined) this.preconditionLink = value.preconditionLink;
    this.profile = value.profile;
    this.frames = value.frames.map((frame) => freezeFrame(frame));
    if (value.termination !== undefined) this.termination = freezeDiagnostics(value.termination);
    Object.freeze(this);
  }
}

export interface ScenarioFrame {
  /** Zero is Arrange; later frames are Act outcomes. */
  readonly at: number;
  readonly act?: ScenarioActRef;
  readonly outcome: ScenarioOutcome;
}

export interface ScenarioActRef {
  readonly key: string;
  readonly occurrence: number;
}

export interface ScenarioUnmatchedAct extends ScenarioActRef {
  readonly side: 'left' | 'right';
}

export type ScenarioOutcome =
  | { readonly kind: 'observed'; readonly snapshot: Digest; readonly state: Digest }
  | { readonly kind: 'unobserved'; readonly diagnostics: readonly Diagnostic[] };

/** Ephemeral evidence. Dropping this value drops the scenario unless it is archived explicitly. */
/** Ephemeral evidence checked for frame-to-snapshot and definition-to-execution consistency. */
export class ScenarioRun {
  declare private readonly checked: true;
  readonly definition: ScenarioDefinition;
  readonly execution: ScenarioExecution;
  readonly snapshots: ReadonlyMap<Digest, SemanticSnapshot>;

  constructor(
    token: typeof scenarioToken,
    value: {
      readonly definition: ScenarioDefinition;
      readonly execution: ScenarioExecution;
      readonly snapshots: ReadonlyMap<Digest, SemanticSnapshot>;
    },
  ) {
    if (token !== scenarioToken) throw new Error('ScenarioRun is constructor-owned');
    this.definition = value.definition;
    this.execution = value.execution;
    this.snapshots = new Map(value.snapshots);
    Object.freeze(this);
  }
}

export interface UnobservedScenarioOutcome {
  readonly kind: 'unobserved';
  readonly diagnostics: readonly Diagnostic[];
}

export type ScenarioObservation = SemanticSnapshot | UnobservedScenarioOutcome;

export interface ScenarioBlindSide {
  readonly band: Band;
  readonly sides: readonly ('left' | 'right')[];
}

/**
 * Which kind of parting an edge is, and which input made it.
 *
 * The same value the composition graph attaches to a divergence, on the axis
 * where two readings are separated by a moment rather than by a page. That is
 * the claim worth stating: *snapshot, act, snapshot* and *snapshot, wait,
 * snapshot* are not two features but one comparison, and the slice is the only
 * place their answers part. {@link PartingSlice} defines the seven.
 *
 * {@link lines} is `explainParting` output — the triage sentence first, then a
 * line per boundary. A run whose collector read no fiber gets the honest pair
 * rather than silence: the slice is `unread`, and the line under it says so.
 */
export interface ScenarioParting {
  readonly slice: PartingSlice;
  readonly lines: readonly string[];
}

export interface ScenarioVariance {
  readonly digest: Digest;
  readonly identical: boolean;
  readonly bands: readonly Band[];
  readonly components: readonly string[];
  readonly unobserved: readonly Band[];
  readonly blindSides: readonly ScenarioBlindSide[];

  /**
   * Why these two readings differ, not merely that they do.
   *
   * `components` names who moved and stops there, which is the same half-finding
   * a divergence carried before it was given a parting: a reader holding it still
   * has to open two frames and diff them by eye. This is the other half.
   *
   * Always present. A parting is decidable from any two snapshots — `unread` is
   * a rung, not a gap — so an absent field here would mean the assessment did not
   * run, and there is no such state.
   */
  readonly parting: ScenarioParting;
}

export type ScenarioComparison =
  | { readonly kind: 'measured'; readonly variance: ScenarioVariance }
  | { readonly kind: 'unobserved'; readonly because: string }
  | { readonly kind: 'unpaired'; readonly because: string };

export type ScenarioEffectDivergence =
  | {
      readonly kind: 'measured';
      readonly identical: boolean;
      readonly left: Digest;
      readonly right: Digest;
    }
  | { readonly kind: 'unobserved'; readonly because: string }
  | { readonly kind: 'unpaired'; readonly because: string };

export interface ScenarioTransitionAssessment {
  readonly act: ScenarioActRef;
  readonly leftEffect: ScenarioComparison;
  readonly rightEffect: ScenarioComparison;
  readonly divergence: ScenarioEffectDivergence;
}

export type ScenarioDivergence =
  | { readonly kind: 'found'; readonly act: ScenarioActRef }
  | { readonly kind: 'none' }
  | { readonly kind: 'unresolved'; readonly because: string };

export interface ScenarioAssessment {
  readonly arrange: ScenarioComparison;
  readonly transitions: readonly ScenarioTransitionAssessment[];
  readonly firstDivergence: ScenarioDivergence;
  readonly unmatched: readonly ScenarioUnmatchedAct[];
}

export function checkedDefinition(value: ScenarioDefinitionData): ScenarioDefinition {
  return new ScenarioDefinition(scenarioToken, value);
}

export function checkedExecution(value: ScenarioExecutionData): ScenarioExecution {
  return new ScenarioExecution(scenarioToken, value);
}

export function checkedRun(value: {
  readonly definition: ScenarioDefinition;
  readonly execution: ScenarioExecution;
  readonly snapshots: ReadonlyMap<Digest, SemanticSnapshot>;
}): ScenarioRun {
  return new ScenarioRun(scenarioToken, value);
}

function freezeFrame(frame: ScenarioFrame): ScenarioFrame {
  const outcome =
    frame.outcome.kind === 'observed'
      ? Object.freeze({ ...frame.outcome })
      : Object.freeze({
          kind: 'unobserved' as const,
          diagnostics: freezeDiagnostics(frame.outcome.diagnostics),
        });
  return Object.freeze({
    at: frame.at,
    ...(frame.act !== undefined ? { act: Object.freeze({ ...frame.act }) } : {}),
    outcome,
  });
}

function freezeDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }));
}
