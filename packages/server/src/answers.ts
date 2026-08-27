import {
  accumulateChurn,
  accumulateFlakiness,
  type Band,
  type Churn,
  type Current,
  type Flakiness,
  type HistoryStore,
  type Journey,
  type Observation,
  type Reach,
  type Window,
} from '@variance-authority/history';
import type { HistoryBackend, WindowQuery } from './backend.js';

/**
 * The questions, built from the five primitives a backend provides.
 *
 * Separate from [`backend.ts`](./backend.ts), which declares what a storage
 * engine must be able to do. This file is what the service actually asks, and the
 * distinction earns its own file for one reason: **every rule about what an
 * answer is made of lives here, and none of it lives in SQL.** Two backends ship
 * — SQLite and a D1 binding — and a rule expressed as a `WHERE` clause has to be
 * written twice, correctly, by two people who will not be reading each other.
 *
 * The rule that was written twice and wrong both times is the one `journeyFrom`
 * now states: which recorded token values count as shipped. It was a
 * `AND accepted = 1` in each backend, against a column no run can ever set, and
 * the result was a drift finding that could not fire anywhere.
 */

/**
 * What is recorded right now for a set of subjects.
 *
 * A pass-through like `lastChangedFrom`, and named for the same reason: every
 * store operation is visibly built from the backend primitives, so the seam is
 * real rather than a thing most calls route around.
 */
export async function currentFrom(
  backend: HistoryBackend,
  project: string | undefined,
  subjects: readonly string[],
): Promise<Current> {
  const scope = project !== undefined ? { project } : {};

  return {
    observations: await backend.currentOf({ ...scope, subjects }),
    tokens: await backend.currentTokens(scope),
  };
}

/**
 * The most recent change to an area.
 *
 * A thin pass-through, and it stays a named function rather than being inlined at
 * the HTTP layer so that all four operations are visibly built from the same five
 * primitives. The value of the seam is only real if nothing routes around it.
 */
export async function lastChangedFrom(
  backend: HistoryBackend,
  project: string | undefined,
  subject: string,
  component: string,
  band?: Band,
): Promise<Observation | null> {
  return backend.lastObservation({
    ...(project !== undefined ? { project } : {}),
    subject,
    component,
    ...(band !== undefined ? { band } : {}),
  });
}

/**
 * How often one component's own code changed.
 *
 * Two slices and one call into the shared arithmetic. The only judgement made
 * here is about consistency between the two slices, and it exists because a limit
 * can cut them apart: the most recent *n* runs and the most recent *n* rows are
 * not the same set of runs, so a row can survive whose run did not. Feeding that
 * row to `accumulateChurn` would add a change to a numerator whose denominator is
 * missing — a rate above its true value, in the alarming direction, with nothing
 * on the page to suggest it.
 *
 * Such rows are dropped from the arithmetic and *added to the omitted count*.
 * That is the whole bargain: they are excluded from the numbers and named in the
 * output, so the answer says it was computed over part of the window instead of
 * quietly being a different answer.
 */
export async function churnFrom(
  backend: HistoryBackend,
  project: string | undefined,
  component: string,
  window: Window,
): Promise<Churn> {
  const query = windowQuery(project, window);
  const runs = await backend.runsIn(query);
  const observations = await backend.observationsOf({ ...query, component });
  // Always fetched, never optional. A churn computed without them reports a
  // component that changed forty times as never having changed, because a run
  // writes every row unapproved and acceptance arrives afterwards.
  const approvals = await backend.approvalsOf(query);

  const registered = new Set(runs.rows.map((run) => run.run));
  const kept = observations.rows.filter((row) => registered.has(row.run));
  const stranded = observations.rows.length - kept.length;

  return accumulateChurn({
    component,
    runs: runs.rows,
    observations: kept,
    approvals: approvals.rows,
    window,
    omittedRuns: runs.omitted,
    omittedObservations: observations.omitted + stranded,
  });
}

/**
 * How often a subject has read differently from itself, and whether it still
 * does.
 *
 * Two slices and one call into the shared arithmetic, exactly like `churnFrom`,
 * and with the same consistency rule for the same reason: a limit can cut the two
 * apart, so an occurrence whose run did not survive is dropped from the counts and
 * added to the omitted total rather than counted against a denominator that is not
 * there.
 */
export async function flakinessFrom(
  backend: HistoryBackend,
  project: string | undefined,
  subject: string,
  window: Window,
): Promise<Flakiness> {
  const query = windowQuery(project, window);
  const runs = await backend.runsIn(query);
  const occurrences = await backend.instabilitiesOf({ ...query, subject });

  const registered = new Set(runs.rows.map((run) => run.run));
  const kept = occurrences.rows.filter((row) => registered.has(row.run));
  const stranded = occurrences.rows.length - kept.length;

  return accumulateFlakiness({
    subject,
    runs: runs.rows,
    occurrences: kept,
    window,
    omittedRuns: runs.omitted,
    omittedOccurrences: occurrences.omitted + stranded,
  });
}

/**
 * What a token has been worth, across the runs somebody agreed to ship.
 *
 * Three slices rather than one, and the second and third are the whole
 * correctness of it. A `TokenValue` carries no acceptance and cannot: the run
 * that wrote it had not been reviewed yet, and this table is append-only, so
 * there is no later moment at which a flag on the row could be corrected. The
 * approval arrives afterwards, keyed by run — exactly as it does for `churnFrom`
 * — and the join has to be made here or not at all.
 *
 * It was, for one release, not made at all: the value rows were filtered on a
 * write-time flag that the CLI sets to `false` on every row it writes, so every
 * journey came back empty and `detectDrift` answered `null` — *this token has not
 * moved* — for tokens that had moved eleven times. A drift finding that cannot
 * fire is worse than an absent feature, because the report says the quiet thing
 * with the same confidence either way.
 *
 * Values from runs nobody approved are dropped rather than counted as omitted.
 * `omitted` means the window's limit cut the slice, which makes every total a
 * lower bound and is reported as such; an unapproved value is not missing from
 * the answer, it is outside the question. A value whose run did not survive the
 * limit *is* stranded, and is counted, for the reason `churnFrom` states.
 *
 * The cost, stated: a quiet run — one that proposed nothing and so has nothing to
 * approve — contributes no reading. Its value equals the standing one by
 * definition, so no step is lost; only `readings`, which counts how many
 * recordings the folded steps came from, is a count of *approved* recordings.
 */
export async function journeyFrom(
  backend: HistoryBackend,
  project: string | undefined,
  token: string,
  window: Window,
): Promise<Journey> {
  const query = windowQuery(project, window);
  const slice = await backend.valuesOf({ ...query, token });
  const runs = await backend.runsIn(query);
  const approvals = await backend.approvalsOf(query);

  // Joined through the commit because that is what a `TokenValue` carries. A run
  // id maps to exactly one commit (`registerRun` refuses otherwise), and two runs
  // over one commit — a second profile, a re-run — approve the same values.
  const approved = new Set(approvals.rows.map((row) => row.run));
  const registered = new Set(runs.rows.map((row) => row.commit));
  const shipped = new Set(
    runs.rows.filter((row) => approved.has(row.run)).map((row) => row.commit),
  );

  const stranded = slice.rows.filter((row) => !registered.has(row.commit)).length;

  return {
    token,
    window,
    values: slice.rows.filter((row) => shipped.has(row.commit)),
    omitted: slice.omitted + stranded,
  };
}

export async function reachFrom(
  backend: HistoryBackend,
  project: string | undefined,
  component: string,
  window: Window,
): Promise<Reach> {
  const rows = await backend.reachOf({ ...windowQuery(project, window), component });
  return {
    component,
    window,
    subjects: rows.subjects,
    arrived: rows.arrived,
    omittedSubjects: rows.omittedSubjects,
  };
}

/**
 * A `HistoryStore` that reads straight from a backend, with no hop.
 *
 * Exported for two reasons, neither of them the HTTP service. First, it is the
 * proof that the five primitives are sufficient: if an operation could not be
 * built from them, this function would not compile, and the interface above would
 * be documenting a claim it does not support. Second, an operator running one CI
 * job on one machine can hold the store directly and skip the port entirely —
 * the service exists because concurrent jobs need one writer, not because a
 * network is part of the design.
 *
 * Its answers are always `kept`. The `Unkept` arm belongs to `createAbsentStore`,
 * where the absence of a record is the fact being reported; a store with a
 * database behind it has a record, and an empty one is a different sentence.
 */
export function createBackedStore(backend: HistoryBackend, project?: string): HistoryStore {
  return {
    async record(run, observations, tokens, instabilities): Promise<void> {
      await backend.append(run, observations, tokens, instabilities);
    },
    async approve(approvals): Promise<void> {
      await backend.appendApprovals(approvals);
    },
    async current(subjects) {
      return currentFrom(backend, project, subjects);
    },
    async lastChanged(subject, component, band) {
      return lastChangedFrom(backend, project, subject, component, band);
    },
    async churn(component, window) {
      return churnFrom(backend, project, component, window);
    },
    async flakiness(subject, window) {
      return flakinessFrom(backend, project, subject, window);
    },
    async valueJourney(token, window) {
      return journeyFrom(backend, project, token, window);
    },
    async reach(component, window) {
      return reachFrom(backend, project, component, window);
    },
  };
}

/**
 * The window, restated for the backend without ever writing `undefined`.
 *
 * `exactOptionalPropertyTypes` makes the difference between "absent" and
 * "present and undefined" a compile error rather than a runtime surprise, which
 * matters here more than it looks: an `until` that is present-and-undefined
 * would reach the SQL builder as a bound nobody asked for.
 */
function windowQuery(project: string | undefined, window: Window): WindowQuery {
  return {
    ...(project !== undefined ? { project } : {}),
    ...(window.since !== undefined ? { since: window.since } : {}),
    ...(window.until !== undefined ? { until: window.until } : {}),
    ...(window.limit !== undefined ? { limit: window.limit } : {}),
  };
}
