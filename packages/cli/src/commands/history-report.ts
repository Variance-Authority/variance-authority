import {
  describeChurn,
  describeDrift,
  describeFlakiness,
  type HistoryStore,
} from '@variance-authority/history';
import type { ChurnRecord, DriftRecord, FlakinessRecord } from '@variance-authority/report';
import type { Config } from '../config.js';
import { recordRun, type RunIdentity, type SubjectHistory } from './history.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * The three states a run can be in about its own record, decided in one place.
 *
 * No record is kept; a record is kept and this run cannot name itself; a record
 * is kept and it can. Split from [`history.ts`](./history.ts) so the loop in
 * `run.ts` calls one function and the recorder itself stays a thing that takes
 * values and returns values, testable with no config and no report.
 *
 * Everything this returns goes into the artifact rather than to a socket held
 * open, which is the rule the whole surface follows: the summary, the
 * pull-request comment and an MCP client read one file, hours apart, and a tool
 * that queried on demand would answer differently depending on when it was asked.
 */

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
  readonly drift?: Readonly<Record<string, DriftRecord>>;
  /**
   * Tokens that took a new value in this run, drifting or not.
   *
   * Not written into the report — the report already has `drift`, which is the
   * sum and the finding. This is handed to the composition phase, which needs the
   * *event*: a component that reads a token that moved has an explanation, and
   * one step is a perfectly good explanation while being no drift at all.
   */
  readonly movedTokens?: readonly string[];
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

  const drift: Record<string, DriftRecord> = {};
  for (const [token, found] of Object.entries(recorded.drift)) {
    drift[token] = {
      from: found.from,
      to: found.to,
      steps: found.steps.length,
      firstAt: found.firstAt,
      lastAt: found.lastAt,
      ...(found.quantity === undefined
        ? {}
        : {
            quantity: {
              unit: found.quantity.unit,
              net: found.quantity.net,
              largestStep: found.quantity.largestStep,
              travel: found.quantity.travel,
            },
          }),
      because: describeDrift(found),
    };
  }

  return {
    ...(Object.keys(flakiness).length > 0 ? { flakiness } : {}),
    ...(Object.keys(churn).length > 0 ? { churn } : {}),
    ...(Object.keys(drift).length > 0 ? { drift } : {}),
    ...(recorded.movedTokens !== undefined ? { movedTokens: recorded.movedTokens } : {}),
    warnings: recorded.warnings,
  };
}
