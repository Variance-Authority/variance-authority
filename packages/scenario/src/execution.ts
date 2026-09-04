import {
  canonicalize,
  digestString,
  type CanonicalValue,
  type Diagnostic,
  type Digest,
  type SemanticSnapshot,
} from '@variance-authority/core';
import type {
  PreconditionLink,
  ScenarioAct,
  ScenarioDefinition,
  ScenarioObservation,
  ScenarioOutcome,
  ScenarioRun,
  UnobservedScenarioOutcome,
} from './contract.js';
import { checkedDefinition, checkedExecution, checkedRun } from './contract.js';

export interface StartScenarioOptions {
  readonly id: string;
  readonly precondition: SemanticSnapshot['subject'];
  readonly profile: SemanticSnapshot['profile']['id'];
  readonly preconditionLink?: PreconditionLink;
}

/**
 * The acts a scenario will perform, fixed before any of them run.
 *
 * Declaring the sequence up front is what makes a partial run legible: a run
 * that stops after two of five acts is three acts unobserved rather than a
 * shorter scenario, and nothing downstream has to infer which. The acts are
 * copied on the way in, so a caller that keeps mutating its own array cannot
 * rewrite the definition a recorded run was checked against.
 */
export function defineScenario(id: string, acts: readonly ScenarioAct[]): ScenarioDefinition {
  requireName(id, 'scenario id');
  for (const act of acts) requireName(act.key, 'act key');
  return checkedDefinition({
    scenarioVersion: 1,
    id,
    acts: acts.map((act) => ({ ...act })),
  });
}

export function unobserved(
  ...diagnostics: readonly Diagnostic[]
): UnobservedScenarioOutcome {
  if (diagnostics.length === 0) {
    throw new Error('an unobserved scenario outcome requires at least one diagnostic');
  }
  return { kind: 'unobserved', diagnostics };
}

/** Content address of the complete canonical semantic object, not its render identity. */
export function semanticSnapshotDigest(snapshot: SemanticSnapshot): Digest {
  return digestString(canonicalize(snapshot as unknown as CanonicalValue));
}

/**
 * Open a run of a definition against one precondition, on one profile.
 *
 * The arrange observation is a parameter rather than an optional because a
 * scenario with no starting state has nothing to be a change *from* — every
 * later act would be reported against whatever the first one happened to
 * produce. Failing to observe it is a legal outcome rather than an error: the
 * run terminates there, and {@link recordAct} refuses everything after.
 */
export function startScenario(
  definition: ScenarioDefinition,
  options: StartScenarioOptions,
  arrange: ScenarioObservation,
): ScenarioRun {
  requireName(options.id, 'execution id');
  // Named here rather than left to the first read of them. The first read is a
  // property access *on* the value that is missing, so an omitted
  // `precondition` answered `Cannot read properties of undefined (reading
  // 'id')` from inside this module while its neighbour on the same options
  // object answered `execution id must not be empty`. Three options are
  // required and the caller supplies all three; they say so the same way.
  requirePrecondition(options.precondition);
  requireName(options.profile, 'execution profile');
  const snapshots = new Map<string, SemanticSnapshot>();
  const outcome = outcomeOf(arrange, options, snapshots);

  const execution = checkedExecution({
    executionVersion: 1,
    id: options.id,
    definition: definition.id,
    precondition: options.precondition,
    ...(options.preconditionLink !== undefined
      ? { preconditionLink: options.preconditionLink }
      : {}),
    profile: options.profile,
    frames: [{ at: 0, outcome }],
    ...(outcome.kind === 'unobserved' ? { termination: outcome.diagnostics } : {}),
  });
  const run = checkedRun({
    definition,
    execution,
    snapshots,
  });
  assertScenarioRun(run);
  return run;
}

/**
 * Add one act's observation, in the order the definition declared it.
 *
 * Returns a new run rather than mutating one. A run is evidence, and evidence
 * that changes shape under the code reading it cannot be compared with the copy
 * something else is already holding. The key is checked against the act the
 * sequence expects, so a suite whose steps have drifted out of order fails
 * naming both keys instead of recording a scenario nobody performed.
 */
export function recordAct(
  run: ScenarioRun,
  key: string,
  observation: ScenarioObservation,
): ScenarioRun {
  assertScenarioRun(run);
  if (run.execution.termination !== undefined) {
    throw new Error('refusing to record an act after the scenario became unobserved');
  }

  const actIndex = run.execution.frames.length - 1;
  const expected = run.definition.acts[actIndex];
  if (expected === undefined) {
    throw new Error(`refusing to record \`${key}\`: scenario \`${run.definition.id}\` has ended`);
  }
  if (expected.key !== key) {
    throw new Error(
      `refusing to record \`${key}\` at act ${actIndex + 1}: scenario \`${run.definition.id}\` expects \`${expected.key}\``,
    );
  }

  const snapshots = new Map(run.snapshots);
  const outcome = outcomeOf(observation, run.execution, snapshots);
  const occurrence =
    run.execution.frames.filter((frame) => frame.act?.key === key).length + 1;
  const frame = {
    at: run.execution.frames.length,
    act: { key, occurrence },
    outcome,
  } as const;

  const execution = checkedExecution({
    ...run.execution,
    frames: [...run.execution.frames, frame],
    ...(outcome.kind === 'unobserved' ? { termination: outcome.diagnostics } : {}),
  });
  const recorded = checkedRun({
    definition: run.definition,
    execution,
    snapshots,
  });
  assertScenarioRun(recorded);
  return recorded;
}

/** Runtime guard for values crossing an archive or untyped host boundary. */
export function assertScenarioRun(run: ScenarioRun): void {
  if (run.definition.scenarioVersion !== 1 || run.execution.executionVersion !== 1) {
    throw new Error('refusing scenario value with an unsupported version');
  }
  requireName(run.definition.id, 'scenario id');
  requireName(run.execution.id, 'execution id');
  if (run.execution.definition !== run.definition.id) {
    throw new Error('refusing scenario execution whose definition identity does not match');
  }
  if (run.execution.frames.length === 0) {
    throw new Error('refusing scenario execution without an Arrange frame');
  }

  const occurrences = new Map<string, number>();
  for (const [index, frame] of run.execution.frames.entries()) {
    if (frame.at !== index) {
      throw new Error(`refusing scenario frame ${index} whose ordinal is ${frame.at}`);
    }
    if (index === 0 && frame.act !== undefined) {
      throw new Error('refusing an Arrange frame carrying an Act');
    }
    if (index > 0) {
      const expected = run.definition.acts[index - 1];
      if (frame.act === undefined || expected === undefined || frame.act.key !== expected.key) {
        throw new Error(`refusing scenario frame ${index} without its authored Act`);
      }
      const occurrence = (occurrences.get(frame.act.key) ?? 0) + 1;
      occurrences.set(frame.act.key, occurrence);
      if (frame.act.occurrence !== occurrence) {
        throw new Error(`refusing scenario frame ${index} with a shifted Act occurrence`);
      }
    }

    if (frame.outcome.kind === 'unobserved') {
      if (frame.outcome.diagnostics.length === 0) {
        throw new Error('refusing an unobserved scenario outcome without diagnostics');
      }
      if (index !== run.execution.frames.length - 1) {
        throw new Error('refusing scenario frames after an unobserved outcome');
      }
    } else {
      const snapshot = run.snapshots.get(frame.outcome.snapshot);
      if (snapshot === undefined) {
        throw new Error(`refusing observed frame without snapshot ${frame.outcome.snapshot}`);
      }
      if (
        semanticSnapshotDigest(snapshot) !== frame.outcome.snapshot ||
        snapshot.renderHash !== frame.outcome.state
      ) {
        throw new Error('refusing observed frame whose snapshot identity does not match');
      }
      if (
        snapshot.subject.id !== run.execution.precondition.id ||
        snapshot.profile.id !== run.execution.profile
      ) {
        throw new Error('refusing observed frame outside its precondition or profile');
      }
    }
  }

  const terminal = run.execution.frames.at(-1)!.outcome;
  if ((terminal.kind === 'unobserved') !== (run.execution.termination !== undefined)) {
    throw new Error('refusing scenario execution whose termination disagrees with its last frame');
  }
}

function outcomeOf(
  observation: ScenarioObservation,
  basis: Pick<StartScenarioOptions, 'precondition' | 'profile'>,
  snapshots: Map<string, SemanticSnapshot>,
): ScenarioOutcome {
  if (isUnobserved(observation)) return observation;
  if (observation.subject.id !== basis.precondition.id) {
    throw new Error(
      `refusing snapshot for \`${observation.subject.id}\` in scenario for \`${basis.precondition.id}\``,
    );
  }
  if (observation.profile.id !== basis.profile) {
    throw new Error(
      `refusing ${observation.profile.id} snapshot in ${basis.profile} scenario execution`,
    );
  }
  const snapshot = semanticSnapshotDigest(observation);
  snapshots.set(snapshot, observation);
  return { kind: 'observed', snapshot, state: observation.renderHash };
}

function isUnobserved(
  observation: ScenarioObservation,
): observation is UnobservedScenarioOutcome {
  return 'kind' in observation && observation.kind === 'unobserved';
}

function requireName(value: string, what: string): void {
  // Absent and blank are different mistakes and the caller fixes them
  // differently, so they are not folded into one sentence. Absent is checked at
  // all because the type saying `string` binds the compiler, not a host that
  // built these options out of a config file.
  if (typeof value !== 'string') throw new Error(`${what} is required`);
  if (value.trim() === '') throw new Error(`${what} must not be empty`);
}

function requirePrecondition(value: SemanticSnapshot['subject']): void {
  if (value === null || typeof value !== 'object') {
    throw new Error('execution precondition is required');
  }
  requireName(value.id, 'execution precondition id');
}
