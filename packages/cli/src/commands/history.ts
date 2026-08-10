import { hashComponents, type SemanticSnapshot, type SourceIndex } from '@variance-authority/core';
import {
  describeChurn,
  describeFlakiness,
  isKept,
  observationsFrom,
  type Churn,
  type Flakiness,
  type HistoryStore,
  type Instability,
  type Observation,
  type RunRecord,
} from '@variance-authority/history';
import type { ChurnRecord, FlakinessRecord } from '@variance-authority/report';
import { filesOf, instabilitiesOf, tokensOf } from './history-rows.js';
import type { Config } from '../config.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * The caller the history record never had.
 *
 * `@variance-authority/history` and `@variance-authority/server` shipped a cycle
 * ago and nothing imported either, which made every question they answer
 * unanswerable in practice: when an area last changed, how often it churns, and —
 * the one this file cares most about — whether a subject that just read
 * differently from itself has been doing that for a month or started today.
 *
 * Three rules govern everything below, and each of them exists because the
 * failure it prevents is silent.
 *
 * **Recording is best-effort and never a verdict.** A history service that is
 * down must not turn a correct run red: the run observed what it observed, and
 * the record is a side effect of it. So a failure here becomes a warning in the
 * report, with the sentence saying what was *not* written — never a thrown error,
 * and never nothing at all.
 *
 * **A quiet run is still recorded.** It is the denominator. A store that only
 * hears from runs in which something moved reports "changed in 4 of 4 runs" for a
 * component that changed in 4 of 40.
 *
 * **The absence of a record is said, not implied.** Every read goes through
 * `isKept`, and an unkept answer is carried into the report as the sentence it
 * came with. An agent handed an empty flakiness record concludes the subject is
 * newly broken; what actually happened is that nobody is keeping a record.
 */

/**
 * What a run has to know about itself before anything can be written down.
 *
 * A `RunRecord` is keyed by `(project, run, profile)` and carries a commit,
 * because lineage is the entire answer a store of observations offers instead of
 * a merge. A run with no id would be indistinguishable from every other run, and
 * one with no commit could never be joined to what anybody actually shipped — so
 * neither is invented here. When they cannot be resolved, nothing is recorded and
 * the report says why.
 */
export interface RunIdentity {
  readonly run: string;
  readonly commit: string;
}

/**
 * The identity of this run, from the flags the operator passed or from the CI
 * environment they are already inside.
 *
 * The environment is read rather than required because the alternative is every
 * adopter editing a workflow file to pass two values their CI already exports,
 * and a step nobody adds is a history nobody keeps. Only the three CI systems
 * this project ships recipes for are recognised, and each pair is read *whole*:
 * a run id from GitHub with a commit from GitLab is a row nobody could ever
 * query.
 *
 * `undefined` means neither the flags nor the environment answered. That is a
 * legitimate state — somebody running `variance run` on a laptop — and it is the
 * caller's job to say so rather than to invent an id.
 */
export function identityOf(
  flags: { readonly run?: string; readonly commit?: string },
  env: Readonly<Record<string, string | undefined>>,
): RunIdentity | undefined {
  // The attempt number is part of the id, not decoration. Re-running a failed
  // job produces a second run at the same commit, and merging the two under one
  // id makes a store refuse the second write for claiming a different… nothing,
  // in fact — it silently counts one run where two happened, and every rate over
  // that window is a little too low.
  const candidates: readonly (readonly [string | undefined, string | undefined])[] = [
    [flags.run, flags.commit],
    [
      env['GITHUB_RUN_ID'] === undefined
        ? undefined
        : `github-${env['GITHUB_RUN_ID']}-${env['GITHUB_RUN_ATTEMPT'] ?? '1'}`,
      env['GITHUB_SHA'],
    ],
    [
      env['CI_PIPELINE_ID'] === undefined ? undefined : `gitlab-${env['CI_PIPELINE_ID']}`,
      env['CI_COMMIT_SHA'],
    ],
    [
      env['BITBUCKET_BUILD_NUMBER'] === undefined
        ? undefined
        : `bitbucket-${env['BITBUCKET_BUILD_NUMBER']}`,
      env['BITBUCKET_COMMIT'],
    ],
  ];

  for (const [run, commit] of candidates) {
    // Both or neither. A pair completed from two sources describes a run that
    // never existed.
    if (run !== undefined && run !== '' && commit !== undefined && commit !== '') {
      return { run, commit };
    }
  }

  return undefined;
}

/** One subject's contribution to the write: its hashes, and whether it held still. */
export interface SubjectHistory {
  readonly subject: string;
  /** Absent when the collector produced no snapshot; no rows are written for it. */
  readonly snapshot?: SemanticSnapshot;
  /** The index that turns a component name into the file that declares it. */
  readonly source?: SourceIndex;

  /**
   * Custom properties in force at this subject's root — the design tokens it
   * resolved, as values rather than as names.
   *
   * This is the axis the whole record was built for and the one that had no
   * source: a button gains 2px eleven times, each approved correctly, and nobody
   * ever sees the 22px change, because the quantity that would catch it is a
   * **sum** and a one-run-at-a-time tool keeps none.
   */
  readonly tokens?: Readonly<Record<string, string>>;
  /** What a second reading said, when the run took one. */
  readonly unstable?: CliObservationRecord['unstable'];
}

export interface RecordRunInput {
  readonly config: Config;
  readonly store: HistoryStore;
  readonly identity: RunIdentity;
  readonly at: string;
  /** Whether this run read **every** subject twice. The flake denominator. */
  readonly swept: boolean;
  readonly subjects: readonly SubjectHistory[];

  /**
   * Components this run named as *causes*, for the churn question.
   *
   * Causes rather than every component that appeared: churn is about a
   * component's own code moving, and asking about the containers an edit pushed
   * around would produce the "widest box in the application keeps changing"
   * answer that the arithmetic itself refuses to accumulate.
   */
  readonly causes?: readonly string[];
}

export interface RecordedRun {
  /** Rows written, for a sentence the operator can check against the store. */
  readonly observations: number;
  readonly instabilities: number;
  /** How often each subject the run found unstable has been unstable before. */
  readonly flakiness: Readonly<Record<string, Flakiness>>;

  /** How often each component this run named as a cause has changed before. */
  readonly churn: Readonly<Record<string, Churn>>;
  /**
   * What could not be recorded or could not be asked, ready to print.
   *
   * A list rather than a thrown error: the run is correct whether or not the
   * store answered, and a warning that says "nothing was written" is the only
   * thing standing between a broken service and a history that silently stops.
   */
  readonly warnings: readonly string[];
}

/**
 * How far back a run looks when asking whether a flake is old news.
 *
 * Thirty days rather than "everything", because the actionable question is about
 * the present suite: a subject that flaked in February and was fixed in March is
 * not what somebody staring at today's red build needs to hear about, and the
 * fix's own evidence — sweeps since — is diluted by every quiet month before it.
 */
const WINDOW_DAYS = 30;

/**
 * How many components one run asks the record about.
 *
 * A run with forty changed subjects can name a hundred causes, and a hundred
 * round trips is a run that finishes noticeably later for an answer nobody reads
 * past the first screen of. Whatever this excludes is reported as excluded — the
 * same rule every capped answer in this system follows.
 */
const MAX_CHURN_QUESTIONS = 20;

/**
 * Write this run down, and ask what the record already knew.
 *
 * The order matters and is not an optimization: the write happens first, so the
 * flakiness answer includes *this* run. A reader told "6 occurrences, and the
 * last sweep still saw it" is reading a sentence that accounts for the finding in
 * front of them; asked before the write, the same subject would report the
 * occurrence count from before it fired, which is off by one in the reassuring
 * direction.
 */
export async function recordRun(input: RecordRunInput): Promise<RecordedRun> {
  const { config, store, identity, at, swept } = input;
  const project = config.history?.project ?? config.project;
  const warnings: string[] = [];

  const run: RunRecord = {
    project,
    run: identity.run,
    commit: identity.commit,
    profile: config.profile,
    at,
    swept,
  };

  const previous = await store.current(input.subjects.map((subject) => subject.subject));
  if (!isKept(previous)) {
    // The absent store's refusal, and the only correct response to it is to stop.
    // Recording against an empty `previous` would write every component of every
    // subject as a change — into a store that is going to discard it anyway.
    return {
      observations: 0,
      instabilities: 0,
      flakiness: {},
      churn: {},
      warnings: [previous.because],
    };
  }

  const bySubject = new Map<string, Observation[]>();
  for (const row of previous) {
    const held = bySubject.get(row.subject);
    if (held === undefined) bySubject.set(row.subject, [row]);
    else held.push(row);
  }

  const observations: Observation[] = [];
  const instabilities: Instability[] = [];

  for (const subject of input.subjects) {
    if (subject.snapshot !== undefined) {
      // Hashed here rather than reused from the comparison, because a subject
      // that settled against its baseline never built a second set — and a quiet
      // subject is exactly the fact the denominator is made of. The cost is a
      // hash of a snapshot the run already holds, against the ~3.4ms it spent
      // collecting it.
      const hashes = hashComponents(subject.snapshot);

      observations.push(
        ...observationsFrom(
          hashes,
          {
            ...run,
            subject: subject.subject,
            // Recorded as unapproved, always. Acceptance is a later decision made
            // by `variance accept` or by a review surface, and a run that marked
            // its own observations approved would make every drift total include
            // changes nobody ever agreed to ship.
            accepted: false,
            files: filesOf(hashes, subject.source),
          },
          bySubject.get(subject.subject) ?? [],
        ),
      );
    }

    instabilities.push(...instabilitiesOf(subject, run));
  }

  const resolved = tokensOf(input.subjects, run, warnings);

  try {
    await store.record(run, observations, resolved, instabilities);
  } catch (error) {
    return {
      observations: 0,
      instabilities: 0,
      flakiness: {},
      churn: {},
      warnings: [
        `nothing was recorded to the history service: ${messageOf(error)}. This run's verdicts ` +
          'are unaffected, and its rows are lost — a later drift or flakiness answer will be ' +
          'computed over a window with this run missing from it',
      ],
    };
  }

  const flakiness: Record<string, Flakiness> = {};
  const since = new Date(Date.parse(at) - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Asked only about the subjects this run has something to say about. A report
  // carrying a flakiness record for all three hundred subjects would be a
  // different artifact, and the questions about the other 299 are what the MCP
  // tools and the service's own routes are for.
  for (const subject of input.subjects) {
    if (subject.unstable === undefined) continue;

    try {
      const answer = await store.flakiness(subject.subject, { since });
      if (isKept(answer)) flakiness[subject.subject] = answer;
      else warnings.push(answer.because);
    } catch (error) {
      warnings.push(
        `the history service could not say how often \`${subject.subject}\` has read differently ` +
          `from itself: ${messageOf(error)}. Absence of an answer is not evidence that this is ` +
          'the first time',
      );
    }
  }

  const churn: Record<string, Churn> = {};

  // Deduplicated by component and capped, because the question is per component
  // and a run with forty changed subjects names the same handful of them. The cap
  // is *reported* rather than silent: a list that stops at twenty without saying
  // so reads as the whole answer.
  const components = [...new Set(input.causes ?? [])];
  for (const component of components.slice(0, MAX_CHURN_QUESTIONS)) {
    try {
      const answer = await store.churn(component, { since });
      if (isKept(answer)) churn[component] = answer;
      else warnings.push(answer.because);
    } catch (error) {
      warnings.push(
        `the history service could not say how often \`${component}\` changes: ` +
          `${messageOf(error)}. Absence of an answer is not evidence that it is stable`,
      );
    }
  }

  if (components.length > MAX_CHURN_QUESTIONS) {
    warnings.push(
      `${components.length - MAX_CHURN_QUESTIONS} component(s) were not asked about: this run ` +
        `named ${components.length} causes and asks the record about ${MAX_CHURN_QUESTIONS}. ` +
        'Their absence from the report is a cap, not a finding',
    );
  }

  return {
    observations: observations.length,
    instabilities: instabilities.length,
    flakiness,
    churn,
    warnings,
  };
}

/**
 * The whole of the run's dealings with a history record, in one call.
 *
 * Lives here rather than in the loop so that `run.ts` stays what it says it is —
 * the loop and the renderer's lifetime — and so that the three states this can be
 * in are decided in one place: no record is kept, a record is kept and this run
 * cannot be named, or a record is kept and it can.
 *
 * The middle state is the one worth a sentence. A configured store with no run id
 * writes nothing, and saying nothing about that produces a history that quietly
 * stops growing the day somebody changes a CI provider — with every later drift
 * answer computed over a window that is missing the runs nobody noticed were
 * absent.
 */
export async function recordIfConfigured(input: {
  readonly config: Config;
  readonly deps: { readonly history?: HistoryStore };
  readonly at: string;
  readonly identity?: RunIdentity;
  readonly swept: boolean;
  /** One slot per planned subject, in plan order; `null` where nothing was read. */
  readonly readings: readonly (SubjectHistory | null)[];
  readonly observations: readonly CliObservationRecord[];
}): Promise<{
  readonly flakiness?: Readonly<Record<string, FlakinessRecord>>;
  readonly churn?: Readonly<Record<string, ChurnRecord>>;
  readonly warnings: readonly string[];
}> {
  const { config, deps, identity } = input;

  // No store configured is not a warning. The operator did not ask for a record,
  // `variance doctor` already says so on its own line, and a run that complained
  // about it every time would teach its reader to skip the warnings.
  if (config.history === undefined || deps.history === undefined) return { warnings: [] };

  if (identity === undefined) {
    return {
      warnings: [
        `a history service is configured at ${config.history.endpoint} and nothing was recorded: ` +
          'this run has no id and commit. Pass `--run` and `--commit`, or run inside a CI system ' +
          'that exports them (GitHub, GitLab, Bitbucket are recognised). A run recorded under an ' +
          'invented id could never be joined to what was shipped, so none was invented',
      ],
    };
  }

  const unstable = new Map(
    input.observations
      .filter((record) => record.unstable !== undefined)
      .map((record) => [record.subject, record.unstable]),
  );

  const subjects = input.readings.filter((reading) => reading !== null).map((reading) => {
    const found = unstable.get(reading.subject);
    return found === undefined ? reading : { ...reading, unstable: found };
  });

  // A subject that failed to collect twice has an `unstable` finding and no
  // reading at all — the collector proved the instability by being unable to
  // repeat it. Recorded from the observation alone, or the loudest form of the
  // thing being measured would be the one occurrence never written down.
  const read = new Set(subjects.map((subject) => subject.subject));
  for (const [subject, found] of unstable) {
    if (!read.has(subject)) subjects.push({ subject, ...(found !== undefined ? { unstable: found } : {}) });
  }

  const recorded = await recordRun({
    config,
    store: deps.history,
    identity,
    at: input.at,
    swept: input.swept,
    subjects,
    // Only the components a region named as the cause of a change. A run that
    // asked about every component it saw would ask about three hundred of them
    // and answer with the container that everything moved inside.
    causes: input.observations.flatMap((record) =>
      record.regions
        .filter((region) => region.cause && region.component !== undefined)
        .map((region) => region.component as string),
    ),
  });

  const flakiness: Record<string, FlakinessRecord> = {};
  for (const [subject, answer] of Object.entries(recorded.flakiness)) {
    flakiness[subject] = {
      runs: answer.runs,
      sweeps: answer.sweeps,
      occurrences: answer.occurrences,
      absorbedRuns: answer.absorbedRuns,
      ...(answer.rate !== undefined ? { rate: answer.rate } : {}),
      sweepsSince: answer.sweepsSince,
      causes: answer.causes,
      ...(answer.firstAt !== undefined ? { firstAt: answer.firstAt } : {}),
      ...(answer.lastAt !== undefined ? { lastAt: answer.lastAt } : {}),
      // The sentence comes from the package that owns the arithmetic, so the
      // report, the comment and an agent all read one phrasing of a distinction
      // — absent record, empty record, record that says this stopped — that three
      // surfaces would otherwise each get subtly wrong.
      because: describeFlakiness(answer),
    };
  }

  const churn: Record<string, ChurnRecord> = {};
  for (const [component, answer] of Object.entries(recorded.churn)) {
    churn[component] = {
      runs: answer.runs,
      changedRuns: answer.changedRuns,
      collateralRuns: answer.collateralRuns,
      rejectedRuns: answer.rejectedRuns,
      ...(answer.firstAt !== undefined ? { firstAt: answer.firstAt } : {}),
      ...(answer.lastAt !== undefined ? { lastAt: answer.lastAt } : {}),
      because: describeChurn(answer),
    };
  }

  return {
    ...(Object.keys(flakiness).length > 0 ? { flakiness } : {}),
    ...(Object.keys(churn).length > 0 ? { churn } : {}),
    warnings: recorded.warnings,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
