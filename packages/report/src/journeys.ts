/**
 * Where this run's subjects parted in the source, carried in the report.
 *
 * The journal a build with probes writes is a cache on the machine that ran
 * the suite, and the readers this section is for read the report somewhere
 * else: the pull-request comment, the MCP tools, the review service. So the run answers
 * the question once, over its own subjects, and writes the answer down beside
 * the verdicts — the rule `flakiness` and `drift` already follow.
 *
 * The shape is the instrument's (`journeyDivergences` in `sense`), written
 * here rather than imported because the format depends on nothing that
 * executes a build. The terms are in `docs/journeys.md`.
 */

/** One region of one module, and who has been inside it. */
export interface JourneyRegionRecord {
  /**
   * The instrument's kind: `function`, `branch`, `case`, `loop`, `handler`,
   * `continuation` or `resume`. A string rather than the instrument's union so
   * a report outlives a kind the instrument stops emitting.
   */
  readonly kind: string;
  /** What the instrument called it, usually the enclosing declaration. */
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Observers of the module that entered it. */
  readonly entered: readonly string[];
  /** Observers of the module that did not. */
  readonly missed: readonly string[];
}

/** One module, its observers, and the regions they did not all enter. */
export interface JourneyParting {
  /** Repository-relative path, as the instrument recorded it. */
  readonly file: string;
  /** Everything that entered this module and was observed whole, sorted. */
  readonly observers: readonly string[];
  /** Regions some observers entered and others did not, in source order. */
  readonly parted: readonly JourneyRegionRecord[];
  /** Regions with source of their own that no observer entered. */
  readonly unentered: readonly JourneyRegionRecord[];
}

/**
 * The partings among this run's subjects, and the pool they were drawn from.
 *
 * The pool travels with the findings because it cannot be recovered from them:
 * a subject that entered no module with source of its own appears in no
 * parting, and a truncated observation appears in none by rule, so `found`
 * alone cannot tell a pool of two from a pool of five that mostly went nowhere.
 */
export interface JourneysReport {
  /** The commit the journal was recorded at; absent outside a checkout. */
  readonly commit?: string;
  /** This run's subjects the journal recorded whole: the pool every parting is about. */
  readonly whole: readonly string[];
  /** This run's subjects whose journal was cut short — out of the pool, and counted so the drop shows. */
  readonly truncated: readonly string[];
  /** This run's subjects the journal holds no row for at all. */
  readonly unrecorded: readonly string[];
  /** Every module with a parted or unentered region, in the instrument's order. */
  readonly found: readonly JourneyParting[];
}
