/**
 * Exit codes — the only part of this CLI that a CI job actually reads.
 *
 * Everything else here produces prose. A pipeline step consumes one integer, and
 * the whole value of running this in CI rests on that integer meaning exactly one
 * thing.
 *
 * ## Why a verdict and a crash may not share a code
 *
 * The tempting design is two codes: `0` fine, non-zero not fine. It fails in both
 * directions, and both failures have been shipped by real tools.
 *
 * - **Collapse "changes need review" into "the tool broke".** The job goes red for
 *   a missing browser as loudly as for a real regression, so the team writes
 *   `continue-on-error: true` — and from then on the tool reports nothing anybody
 *   is required to read.
 * - **Collapse "the tool broke" into "changes need review".** Worse. A run that
 *   never launched a renderer reports "nothing changed" with the confidence of a
 *   run that compared three hundred subjects, and the check that was supposed to
 *   catch the regression passes green while observing nothing.
 *
 * So: `2` is reserved for *the run did not happen as configured*, and is never
 * produced by a finding. `1` is reserved for *the run happened and found
 * something a person must look at*, and is never produced by a failure. A caller
 * can therefore branch on `2` to page whoever owns the runner image and on `1` to
 * ask a reviewer, which are different people and different urgencies.
 *
 * The costs, stated. Three codes are more to remember than two, and a shell
 * `set -e` treats them identically — a caller who wants the distinction has to ask
 * for it. That is accepted, because the alternative is a distinction nobody *can*
 * ask for.
 */

/** Nothing needs review. Claimed only when the run can account for every subject. */
export const EXIT_CLEAN = 0;

/** The run completed and found something a human must decide about. */
export const EXIT_REVIEW = 1;

/**
 * The run did not happen as configured: bad config, missing browser, unreachable
 * store. Never a statement about the product under test.
 */
export const EXIT_OPERATOR = 2;

export type ExitCode = typeof EXIT_CLEAN | typeof EXIT_REVIEW | typeof EXIT_OPERATOR;

/**
 * The property a thrower sets to say "this is the operator's to fix".
 *
 * The contract between a collector and this CLI, and the reason it is a bare
 * property name rather than a shared class. A collector is loaded by dynamic
 * import from the operator's own `node_modules`, so it holds *its* copy of
 * whatever package declares the class — and `instanceof` across two copies is
 * `false`. A class alone would work in this repository, pass its tests, and then
 * degrade in the field into precisely the failure it exists to prevent: a
 * misconfigured suite told it has found a bug in the tool.
 *
 * A name, like a header name, survives that. It is also what lets a third-party
 * collector participate without taking a dependency on the CLI that will run it:
 * `Object.assign(new Error(why), { varianceOperatorError: true })` is the whole
 * integration.
 *
 * This is still not a message convention. The thrower *declares* the
 * classification; nothing here reads what the error says.
 */
export const OPERATOR_ERROR_MARKER = 'varianceOperatorError';

/**
 * The error that means `2`.
 *
 * A distinct class rather than a message convention, because the mapping from
 * "something went wrong" to an exit code is exactly what must not be done by
 * matching on text. Anything thrown that is *not* recognised by
 * {@link isOperatorError} is a defect in this CLI, and `bin.ts` reports it as
 * such rather than dressing it up as an operator problem.
 */
export class OperatorError extends Error {
  readonly exitCode: typeof EXIT_OPERATOR = EXIT_OPERATOR;

  /** See {@link OPERATOR_ERROR_MARKER}. Spelled out, because the name is the contract. */
  readonly varianceOperatorError = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OperatorError';
  }
}

/**
 * Whether an error is a statement about the operator's configuration.
 *
 * Structural rather than `instanceof`, for the reason
 * {@link OPERATOR_ERROR_MARKER} gives.
 */
export function isOperatorError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<string, unknown>)[OPERATOR_ERROR_MARKER] === true
  );
}

/**
 * The shape {@link exitFor} needs, and nothing more.
 *
 * Structural rather than an import of `CliRunReport`, so this module has no
 * dependencies at all. The exit code is the contract with CI; a module that
 * decides it should not be able to acquire a reason to open a browser.
 */
export interface ReviewableReport {
  readonly observations: readonly {
    readonly verdict: 'unchanged' | 'changed' | 'new' | 'incomparable' | 'ignored';

    /**
     * What the collection of this subject could not do, carried from the record.
     *
     * Only the severity is read, because that is the whole decision. Naming the
     * codes here would make this module hold a list of every diagnostic the
     * collectors can emit and re-decide, by text, which of them are serious — the
     * mapping this file exists not to do (see {@link OperatorError}). The
     * collector that raised the diagnostic is the only party that knows whether
     * it describes a limit or a hole, and it says so in one field.
     */
    readonly diagnostics?: readonly {
      readonly severity: 'warn' | 'error';
    }[];

    /**
     * Set when two readings of this subject, seconds apart, disagreed.
     *
     * Only `absorbed` is read, and only for whether it is there. What the field
     * *says* — a component, a file, a band — is a statement about the page and is
     * somebody's work; what this module needs is the one bit that decides an exit
     * code, and that bit is whether the movement fell inside what the subject
     * declared it asserts on. Outside it, the operator has already answered.
     */
    readonly unstable?: { readonly absorbed?: unknown };
  }[];

  /**
   * Subjects the run did not observe, with why. **Absent is not empty.**
   *
   * A report that does not state what it skipped cannot support the sentence
   * "nothing needs review", because silence about a subject is indistinguishable
   * from a pass. So absence is treated as an open question, not as a clean run —
   * see {@link exitFor}.
   */
  readonly notObserved?: readonly { readonly kind: 'excluded' | 'failed' | 'unreached' }[];
}

/**
 * Verdicts that do not, on their own, hold a run open.
 *
 * A list rather than a `!== 'unchanged'`, because there are now two ways for a
 * subject to be green and they mean different things: nothing moved, or nothing
 * moved *outside what the operator excluded*. Writing the second as the first is
 * how the distinction would quietly disappear from every count downstream.
 */
const GREEN: readonly string[] = ['unchanged', 'ignored'];

/**
 * The verdict code for a completed run: `0` or `1`, never `2`.
 *
 * Five things move it to `1`, and the last three are the ones a pixel-diff tool
 * gets wrong:
 *
 * - `changed` — the obvious one.
 * - `new` — no baseline exists. Not a regression and not a pass; nobody has ever
 *   agreed what this subject should look like, and exiting `0` would let a
 *   subject enter the suite unreviewed forever.
 * - `incomparable` — a baseline exists on another machine. The comparison was
 *   *refused*, so nothing is known, and an unobservable difference is never
 *   reported as no difference.
 * - a `failed` entry in {@link ReviewableReport.notObserved} — the run meant to
 *   look and could not. This is the rule ADR-0017 states, in one
 *   line: a subject that cannot be observed does not silently pass.
 * - an `unstable` observation the subject's own declaration did not absorb — it
 *   was read twice with nothing changed in between and the two readings
 *   disagreed, so its verdict was decided by whichever came first. On an ordinary
 *   run this changes nothing, because such a subject is already `changed`; under
 *   `--flakes` it is the whole point, and a sweep that found six and exited `0`
 *   would have told CI nothing it could act on. An instability whose every band
 *   falls outside what the subject asserts on is *not* one of these — see the
 *   fourth entry below.
 * - an `error` diagnostic on an observation — the run *did* look, at less than
 *   the subject. A design system served from a cross-origin `<link>` is skipped
 *   by the collector on both sides of the comparison, so the images agree, the
 *   verdict is honestly `unchanged`, and the subject was compared with a chunk of
 *   its styling missing. No verdict can express that, because the verdict is a
 *   statement about two images and this is a statement about what went into them.
 *
 * Four things deliberately do not move it. An **absorbed** instability: the
 * subject declared what it asserts on, every band that moved falls outside it,
 * and a route written to ignore what the page is painted with must not go red
 * over exactly that — the same decision `ignored` records about pixels, one level
 * up and about kinds. `ignored` observations: pixels moved
 * and every one of them fell inside a subtree the operator excluded, which is the
 * same decision an `excluded` entry records one level up. It is a separate
 * verdict from `unchanged` rather than the same one precisely so that it can be
 * counted here without being confused with earned green — see spec 0024, and the
 * register that reports an ignore absorbing nothing. `excluded` entries: the operator's own
 * configuration saying "do not look here" is a decision that was already made and
 * reviewed. And `warn` diagnostics: they state a standing limit of the profile or
 * the configuration — `unverified-fonts` fires on every subject of a suite that
 * supplied no font hashes — and a gate that is red on every run of a correctly
 * configured suite is a gate that gets switched off. Both are recorded either
 * way; what changes is only whether they hold the run open.
 */
export function exitFor(report: ReviewableReport): typeof EXIT_CLEAN | typeof EXIT_REVIEW {
  const needsReview = report.observations.some(
    (observation) =>
      !GREEN.includes(observation.verdict) ||
      (observation.unstable !== undefined && observation.unstable.absorbed === undefined) ||
      (observation.diagnostics ?? []).some((diagnostic) => diagnostic.severity === 'error'),
  );
  if (needsReview) return EXIT_REVIEW;

  // Undefined rather than empty: the writer never said. See the field's note.
  if (report.notObserved === undefined) return EXIT_REVIEW;

  return report.notObserved.some((entry) => entry.kind === 'failed') ? EXIT_REVIEW : EXIT_CLEAN;
}
