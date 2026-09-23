/**
 * What the commit reaches, joined to what the run saw.
 *
 * Every other section of a report is an answer about *pixels*: this subject
 * against its baseline, this suite against itself. This one is the answer about
 * *cause*, and it is built from three things no diff tool holds at once — the
 * paths git named, the file graph a scanner read off disk, and the component
 * list each baseline recorded when it was painted.
 *
 * Walking the graph backwards from every changed file gives the set of
 * components an edit can possibly have moved, and the trail that carried it:
 * `app/src/tokens.css → app/src/components/ui/button.css → Button`. A subject
 * renders components, so the same walk says, per subject, whether this commit
 * could have touched it.
 *
 * ## The reason this is worth an artifact rather than a log line
 *
 * The same computation already exists one directory over as `--since`, where it
 * is used to *skip* subjects and then discarded. Skipping is a saving; this is
 * the finding. Crossed against the verdicts the run produced, reach sorts every
 * subject into four states, and two of them are questions nobody else in this
 * category can even ask:
 *
 * - **reached and changed** — the expected case, and the trail names the file.
 * - **reached and unchanged** — the edit is inert here. No diff tool asserts
 *   anything about a green subject, so the surface an author *believed* they were
 *   changing and did not is invisible everywhere else.
 * - **unreached and changed** — nothing in this commit reaches this subject, and
 *   it moved anyway. That is a flake, an input from outside the repository, or a
 *   hole in the graph, and it is a different bug in each case.
 * - **unreached and unchanged** — counted, never listed.
 *
 * The states are not stored. They are `reached × verdict`, and the verdicts are
 * already in the report; writing them down as a fifth field would be a second
 * copy of a fact that can disagree with the first.
 *
 * ## Every refusal here is louder than an answer
 *
 * A graph that cannot place a changed file cannot say what that file reaches,
 * and the difference between *this edit reaches nothing* and *this edit was not
 * understood* is the difference between a finding and a lie. So `subjects` is
 * absent rather than empty when the attribution could not be made, and `whole`
 * carries the reason in the same words the selector would have used to refuse to
 * narrow.
 */

/** A component the diff reaches, and the chain that carried it there. */
export interface ReachedComponent {
  readonly component: string;

  /**
   * The shortest chain from a seed to this component: seed first, component
   * last, every step a repository-relative path but the last.
   *
   * Shortest because the traversal is breadth-first, so the explanation printed
   * is the shortest true one rather than whichever a stack happened to unwind.
   */
  readonly trail: readonly string[];
}

/** Whether this commit could have moved this subject, and through what. */
export interface SubjectReach {
  readonly reached: boolean;

  /**
   * Components this subject's baseline records that the diff reaches, sorted.
   *
   * Empty exactly when `reached` is `false`.
   */
  readonly through: readonly string[];

  /** The trail to the first of them. Absent when nothing was reached. */
  readonly trail?: readonly string[];

  /** One sentence, ready to print, either way it went. */
  readonly because: string;
}

/**
 * What the commit reaches, as the run recorded it.
 *
 * The half of a comparison no comparison can produce. A diff says which files an
 * author touched; the import graph says which components those files reach; the
 * suite says which subjects render those components. Put together they answer the
 * question a reviewer actually has in front of a changed screenshot — *did I do
 * this?* — and the answer is occasionally **no**, which is the strongest signal on
 * the page and one nothing that only compares pixels can ever emit.
 *
 * Every field is written so the report can say *unknown* as loudly as it says
 * *yes* and *no*. `whole` is the walk's refusal to attribute, `unscanned` the
 * changed files it could not place, and `subjects` is absent rather than empty when none of it could be attributed —
 * because a commit that was understood and reaches nothing supports the opposite
 * decision to a commit nothing could be read from.
 */
export interface ReachReport {
  /** The ref the diff was taken against, in the operator's own words. */
  readonly against: string;

  /** Repository-relative paths the diff named. */
  readonly changed: readonly string[];

  /**
   * Components the diff reaches, sorted by name.
   *
   * The whole answer, independent of any subject — a component here that appears
   * in no subject's `through` is a component this suite does not watch, which is
   * a coverage question rather than a review one.
   */
  readonly components: readonly ReachedComponent[];

  /**
   * Per planned subject, keyed by id. **Absent is not empty.**
   *
   * Absent means nothing here could be attributed and `whole` says why; every
   * subject must then be read as possibly reached. Empty would mean the opposite
   * — that the commit was understood and reaches none of them — and those two
   * support opposite decisions.
   *
   * A subject whose baseline recorded no component list is simply not a key: the
   * run does not know what it is made of, so it cannot say what reaches it.
   */
  readonly subjects?: Readonly<Record<string, SubjectReach>>;

  /**
   * Why nothing could be attributed, when nothing could.
   *
   * Present exactly when `subjects` is absent. A changed file under the scanned
   * roots that the graph never saw, a diff entirely outside the graph, a diff
   * that reaches no component at all: each of those looks identical to an edit
   * that genuinely affects nothing, and only one of them is safe to act on.
   */
  readonly whole?: string;

  /**
   * Changed files under the scanned roots the graph does not hold.
   *
   * A gap in the scan rather than a file that affects nothing — the roots are the
   * operator's own statement of where renders come from.
   */
  readonly unscanned?: readonly string[];
}
