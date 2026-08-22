/**
 * What the store answered, flattened into the report.
 *
 * Three shapes, and each is a copy of something `@variance-authority/history`
 * already has. Deliberately: a report is opened by a reader that has a JSON file
 * and nothing else, and importing the history package to name the type of a
 * field would make reading a run report require installing a database client.
 *
 * They are together because they answer one question between them — *what does
 * this suite's past say about what it just did* — and apart from `format.ts`
 * because that question is the only one in the report a run cannot answer on its
 * own. A run with no history configured has none of these, and its report is not
 * missing anything it could have produced.
 */

/** What one token has drifted to, and how far it travelled getting there. */
export interface DriftRecord {
  readonly from: string;
  readonly to: string;
  /** Value changes behind it. One is not drift; this is never below two. */
  readonly steps: number;
  readonly firstAt: string;
  readonly lastAt: string;

  /**
   * The arithmetic, when every value was the same kind of quantity.
   *
   * Absent for a colour, a font stack, or a mixed set of units — and absent means
   * *not measurable*, never zero. `because` says which.
   */
  readonly quantity?: {
    readonly unit: string;
    readonly net: number;
    /** The largest single step: the most any one review could have seen. */
    readonly largestStep: number;
    /** Sum of the absolute steps, which exceeds `|net|` whenever it changed direction. */
    readonly travel: number;
  };

  /** One sentence, ready to print, from the package that owns the arithmetic. */
  readonly because: string;
}

/**
 * How often one component's own code has changed, over a window.
 *
 * A structural copy of `@variance-authority/history`'s `Churn`, for the reason
 * {@link FlakinessRecord} is one: this package requires nothing, and a report
 * reader must not have to install a history client to open a file.
 */
export interface ChurnRecord {
  /** Runs in the window, quiet ones included. The denominator. */
  readonly runs: number;

  /** Runs in which this component caused an **approved** change in any band. */
  readonly changedRuns: number;

  /**
   * Runs in which only this component's geometry moved — it was *displaced* by an
   * edit somewhere else. Reported, never summed: accumulating displacement makes
   * the widest container in the application the thing that keeps changing, in
   * every run, forever.
   */
  readonly collateralRuns: number;

  /** Runs carrying a change to this component that nobody approved. */
  readonly rejectedRuns: number;

  readonly firstAt?: string;
  readonly lastAt?: string;

  /** One sentence, ready to print, from the package that owns the arithmetic. */
  readonly because: string;
}

/**
 * How often one subject has failed to read the same way twice.
 *
 * A structural copy of `@variance-authority/history`'s `Flakiness` rather than an
 * import of it: this package requires nothing, and a report reader must not have
 * to install a history client to open a file. The two are kept in step by the
 * writer — `cli`, which imports both — and the fields that could drift are the
 * ones with a rule attached, restated here so a reader of the artifact meets it.
 */
export interface FlakinessRecord {
  /** Distinct runs recorded in the window, whatever they examined. */
  readonly runs: number;

  /**
   * Distinct runs that read **every** subject twice, and the only honest
   * denominator: an ordinary run asks a subject whether it agrees with itself
   * only after calling it `changed`, so a green subject's silence in one is not
   * evidence of anything.
   */
  readonly sweeps: number;

  /** Distinct runs in which this subject read differently and was not absorbed. */
  readonly occurrences: number;

  /**
   * Runs whose instability fell entirely in bands this subject does not assert
   * on — working as declared, never a finding, counted so a rule that absorbs
   * something forever can still be asked about.
   */
  readonly absorbedRuns: number;

  /** Occurrences per sweep. **Absent when no sweep has run**, and never zero. */
  readonly rate?: number;

  /**
   * Sweeps recorded since the most recent occurrence. Counted in sweeps rather
   * than in days, so a suite that stopped running does not look increasingly
   * fixed the longer nobody looks at it.
   */
  readonly sweepsSince: number;

  /** What read differently, loudest first. Empty when nothing could be named. */
  readonly causes: readonly {
    readonly component?: string;
    readonly band?: string;
    readonly runs: number;
  }[];

  readonly firstAt?: string;
  readonly lastAt?: string;

  /** One sentence, ready to print, from the package that owns the arithmetic. */
  readonly because: string;
}
