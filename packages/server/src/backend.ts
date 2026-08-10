import {
  accumulateChurn,
  accumulateFlakiness,
  type Approval,
  type Band,
  type Churn,
  type Flakiness,
  type HistoryStore,
  type Instability,
  type Journey,
  type Observation,
  type Reach,
  type RunRecord,
  type TokenValue,
  type Window,
} from '@variance-authority/history';

/**
 * The seam between the questions and the engine that answers them.
 *
 * `@variance-authority/history` owns the contract, the arithmetic, and the
 * client; this package owns storage. `HistoryBackend` is the line between them,
 * and it exists so that replacing SQLite with Postgres, or with something that
 * shards by project, changes exactly one file — not the client, not the drift
 * arithmetic, and above all not the recorded shape. Spec 0002 makes that a known
 * limit rather than a wish: one service process owns one SQLite file, and the
 * day that ceases to be enough the replacement must not be allowed to renegotiate
 * what a row means.
 *
 * The primitives below are deliberately smaller than the `HistoryStore`
 * operations. Each one is a slice a single index can serve, and every rule that
 * could be got wrong — which changes count, what a denominator is, when a rate
 * may be divided — stays in `accumulateChurn`, in the other package, where it is
 * tested against hand-written histories rather than against a query somebody has
 * to trust. A backend that computed churn itself would have to re-derive four
 * rules per engine, and the second engine would get one of them wrong silently.
 *
 * What a backend is *not* allowed to do is decide anything is uninteresting.
 * Every slice reports what a limit excluded, because a capped answer that does
 * not say it was capped reads as a complete one, and a drift total computed over
 * a truncated slice is a lower bound that its reader will treat as the amount the
 * product moved.
 */

/**
 * Scopes a query to one project, or deliberately does not.
 *
 * Optional because a single-project deployment has nothing to scope, and
 * dangerous to omit on a shared one: an unscoped query blends two projects'
 * `Button` into one rate and nothing in the answer would show it. The choice is
 * the caller's — the client sets it per request — so the backend must implement
 * both rather than picking a default that silently changes what a number means.
 */
export interface BackendQuery {
  readonly project?: string;
}

/** The area `lastChanged` asks about: one component inside one subject. */
export interface AreaQuery extends BackendQuery {
  readonly subject: string;
  readonly component: string;
  /** Absent asks for the most recent change in any band. */
  readonly band?: Band;
}

/**
 * The subjects a run is about to write, for the one read about the present.
 *
 * No window and no limit, deliberately, and a backend may not add either. The
 * answer is the latest row per live scope inside these subjects, which is bounded
 * by the code under test rather than by the age of the project — and a *partial*
 * answer here is not a lower bound, it is a change that did not happen, appended
 * permanently (`HistoryStore.current`).
 */
export interface SubjectsQuery extends BackendQuery {
  readonly subjects: readonly string[];
}

/**
 * A window, as the store sees it.
 *
 * `since` and `until` are ISO-8601 instants, and a backend MUST compare them as
 * instants rather than as text. ISO-8601 only sorts lexically while every
 * timestamp shares one offset, and a store fed by CI jobs in two regions does
 * not — a lexical window silently excludes rows from the other region, which is
 * a drift total that is quietly too small.
 */
export interface WindowQuery extends BackendQuery {
  readonly since?: string;
  readonly until?: string;
  /** Maximum rows to return. Whatever it excludes must come back as a count. */
  readonly limit?: number;
}

export interface ComponentWindowQuery extends WindowQuery {
  readonly component: string;
}

export interface SubjectWindowQuery extends WindowQuery {
  readonly subject: string;
}

export interface TokenWindowQuery extends WindowQuery {
  readonly token: string;
}

/**
 * Rows, and the number of rows there would have been.
 *
 * `omitted` is a count and never a flag. "Some rows were left out" cannot be
 * subtracted from a total; `omitted: 37` tells a reader how wrong a lower bound
 * might be, and that is the difference between a number worth acting on and a
 * number worth ignoring.
 */
export interface Slice<Row> {
  readonly rows: readonly Row[];
  readonly omitted: number;
}

/**
 * Reach comes back pre-reduced because `arrived` cannot be derived from the
 * window's own rows.
 *
 * "Where a component appeared for the first time this quarter" requires knowing
 * whether it was ever seen *before* the quarter, which is a lookup outside the
 * window. Returning raw rows and letting a caller reduce them would produce an
 * `arrived` list containing every subject, in every window, forever — the
 * component would appear to have just arrived everywhere each time it was asked
 * about.
 */
export interface ReachRows {
  /** Subjects observed in the window, in first-seen order. */
  readonly subjects: readonly string[];
  /** Of those, the ones whose first-ever observation falls inside the window. */
  readonly arrived: readonly string[];
  readonly omittedSubjects: number;
}

/**
 * Raised when a write cannot be reconciled with what is already stored.
 *
 * Its own class because the HTTP layer answers it with 409 rather than 500: a run
 * id reused for a second commit is the caller's mistake, and reporting it as a
 * server fault sends the operator to inspect a database that is behaving
 * correctly.
 */
export class HistoryWriteConflict extends Error {
  override readonly name = 'HistoryWriteConflict';
}

export interface HistoryBackend {
  /**
   * Append one run: the run itself, the rows whose hashes moved, and the values
   * it resolved. Atomic, or the store is worse than useless — rows without their
   * run leave a change with no denominator, and a run without its rows is a quiet
   * run that was not quiet.
   *
   * Appending the same run twice is not an error. A caller whose components were
   * approved separately calls `record` twice with the two halves, and a run
   * counted twice halves every rate computed from it forever.
   */
  append(
    run: RunRecord,
    observations: readonly Observation[],
    tokens: readonly TokenValue[],
    instabilities?: readonly Instability[],
  ): Promise<void>;

  /**
   * Append acceptances. Appending the same one twice is not an error: a reviewer
   * who approves a subject twice has approved it once, and a store that refused
   * the second would turn a double click into a failed command.
   */
  appendApprovals(approvals: readonly Approval[]): Promise<void>;

  /**
   * Acceptances in the window, for the subjects a component appears in.
   *
   * Scoped by window rather than by component, because an approval is about a
   * subject and a run: the join to a component happens in the arithmetic, where
   * the rows are. A backend that tried to narrow it here would need to know which
   * subjects hold the component, which is the observations query it already ran.
   */
  approvalsOf(query: WindowQuery): Promise<Slice<Approval>>;

  /**
   * The latest row per `(subject, component, band, profile)` for the named
   * subjects, and nothing older.
   *
   * Returned raw rather than reduced, because the rule that folds them —
   * `structure` compares across profiles and the other two do not — belongs to
   * `observationsFrom` in the other package, next to the write it governs. A
   * backend that reduced them here would be a second implementation of the scope
   * rule, and the two would disagree on the day a band changes portability.
   */
  currentOf(query: SubjectsQuery): Promise<readonly Observation[]>;

  /** The most recent row for an area, or `null` when the record contains none. */
  lastObservation(query: AreaQuery): Promise<Observation | null>;

  /**
   * Every run in the window, quiet ones included — one entry per `(run, profile)`.
   *
   * This is the denominator, and it is a separate query from the observations on
   * purpose. A store that inferred runs from the rows it holds would report
   * "changed in 4 of 4 runs" for a component that changed in 4 of 40.
   */
  runsIn(query: WindowQuery): Promise<Slice<RunRecord>>;

  /** Every recorded row for one component in the window, approved or not. */
  observationsOf(query: ComponentWindowQuery): Promise<Slice<Observation>>;

  /**
   * Every occurrence of one subject reading differently from itself, in the
   * window, absorbed ones included.
   *
   * Absorbed rows come back rather than being filtered here, because whether an
   * occurrence counts as a finding is a rule — `absorbedBy` present means working
   * as declared — and rules live in the arithmetic, next to the counters they
   * govern.
   */
  instabilitiesOf(query: SubjectWindowQuery): Promise<Slice<Instability>>;

  /**
   * The values one token resolved to in the window, oldest first.
   *
   * Filtered to writes that carried an approval; see the acceptance rule in
   * `backend-sqlite`. A journey through values that were never shipped is the
   * "describes the review process rather than the product" failure in its most
   * convincing form, because every number in it looks real.
   */
  valuesOf(query: TokenWindowQuery): Promise<Slice<TokenValue>>;

  reachOf(query: ComponentWindowQuery): Promise<ReachRows>;

  close(): Promise<void>;
}

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
): Promise<readonly Observation[]> {
  return backend.currentOf({ ...(project !== undefined ? { project } : {}), subjects });
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

export async function journeyFrom(
  backend: HistoryBackend,
  project: string | undefined,
  token: string,
  window: Window,
): Promise<Journey> {
  const slice = await backend.valuesOf({ ...windowQuery(project, window), token });
  return { token, window, values: slice.rows, omitted: slice.omitted };
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
