import { hashComponents, type SemanticSnapshot, type SourceIndex } from '@variance-authority/core';
import {
  detectDrift,
  isKept,
  observationsFrom,
  type Churn,
  type Flakiness,
  type HistoryStore,
  type Instability,
  type Observation,
  type RunRecord,
  type TokenDrift,
} from '@variance-authority/history';
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
   * Tokens whose value moved in this run, and what they have drifted to.
   *
   * The finding this whole tier exists for: a button gains 2px, eleven times,
   * each approved correctly, and nobody ever sees the 22px — because the quantity
   * that would catch it is a sum, and no single review holds one.
   */
  readonly drift: Readonly<Record<string, TokenDrift>>;

  /**
   * The names of the tokens that moved, whether or not they have drifted.
   *
   * A superset of `drift`'s keys and a different question. `drift` is the *sum* —
   * a token has to have moved more than once in the window to have a journey
   * worth reporting — and this is the *event*: which custom properties resolved
   * to a new value in this run. One step is not drift and it is a perfectly good
   * explanation for a component whose output moved, which is what
   * `attributeMovement` reads it for.
   *
   * Absent when nothing could be asked — no store answered, or the write failed
   * before the comparison was trustworthy. Absent is not `[]`: an empty list is
   * the claim *no token moved*, which would let an attribution rule out the token
   * rung on the strength of a service being down.
   */
  readonly movedTokens?: readonly string[];

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
 * How many moved tokens one run asks a journey for.
 *
 * A run in which fifty tokens moved is a theme change, and fifty journeys would
 * describe it fifty times over. The cap is generous because the usual number is
 * zero, and whatever it excludes is reported.
 */
const MAX_DRIFT_QUESTIONS = 10;

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
      drift: {},
      warnings: [previous.because],
    };
  }

  const bySubject = new Map<string, Observation[]>();
  for (const row of previous.observations) {
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

  // Which of them the record has never seen at this value. Computed before the
  // write, because afterwards every one of them is the latest recorded value and
  // the question answers itself with "none".
  const held = new Map(previous.tokens.map((row) => [row.token, row.value]));
  const moved = resolved.filter((row) => held.has(row.token) && held.get(row.token) !== row.value);

  try {
    await store.record(run, observations, resolved, instabilities);
  } catch (error) {
    return {
      observations: 0,
      instabilities: 0,
      flakiness: {},
      churn: {},
      drift: {},
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

  const drift: Record<string, TokenDrift> = {};

  // Only the tokens that moved in *this* run, which is almost always none and
  // occasionally one. Asking about every token a project declares would be fifty
  // round trips for an answer that is the same as last run's.
  for (const row of moved.slice(0, MAX_DRIFT_QUESTIONS)) {
    try {
      const journey = await store.valueJourney(row.token, { since });
      if (!isKept(journey)) {
        warnings.push(journey.because);
        continue;
      }
      // `null` means the values in the window never changed, which is not a
      // finding — this run's own change is the first, and one step is not drift.
      const found = detectDrift(journey);
      if (found !== null) drift[row.token] = found;
    } catch (error) {
      warnings.push(
        `the history service could not say what \`${row.token}\` has drifted to: ` +
          `${messageOf(error)}. Absence of an answer is not evidence that it has held still`,
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
    drift,
    movedTokens: moved.map((row) => row.token).sort(),
    warnings,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
