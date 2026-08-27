import type {
  Approval,
  Band,
  Instability,
  Observation,
  RunRecord,
  TokenValue,
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

  /**
   * The latest recorded value per token, for the whole project.
   *
   * Unscoped by subject because a token is not a subject's: it records what the
   * *product's* `--va-space-3` resolved to. Bounded by the size of the design
   * system rather than by the age of the project, which is what keeps it inside
   * the rule that nothing here loads a whole history.
   */
  currentTokens(query: BackendQuery): Promise<readonly TokenValue[]>;

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
