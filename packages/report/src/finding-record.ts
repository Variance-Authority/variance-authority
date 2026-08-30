/**
 * A defect the run found by reading one render, and when it arrived.
 *
 * Its own file because two of its fields are about provenance rather than about
 * the defect, and they are the two a surface gets wrong by omission. A finding is
 * produced with no baseline consulted — that is the half a comparison
 * structurally cannot produce — and the consequence is that the same list is
 * printed on the run that introduced a defect and on every run after it, under a
 * heading that does not say what kind of defect it is. `band` and `standing` are
 * what make the list sayable and datable, and the rules for reading them absent
 * are written on them.
 */

/**
 * One defect in a render, flattened for the report.
 *
 * Same fields a `RegionRecord` carries and for the same reason: what, where,
 * whose, which file. The owner chain is dropped — it is an in-memory structure
 * with a props digest per frame, and a report is read by something that wants a
 * sentence.
 */
export interface FindingRecord {
  /** e.g. `control-without-name`. Stable, so an ignore list can name one. */
  readonly rule: string;

  /**
   * The band this defect would block under — `a11y`, `geometry`, `content`.
   *
   * What makes the list sayable. Nine of the eleven rules are accessibility and
   * two are not, so a panel headed *Accessibility* would be wrong about
   * `untranslated` and `overflows-container`, and a panel headed nothing at all
   * leaves a reader to infer the subject of the report from the rule slugs. The
   * band is the axis the project already blocks on (`blocking: ['a11y']`), which
   * makes the heading a reader sees and the policy that stops their merge the
   * same word.
   *
   * Optional because a report written before this existed carries none, and a
   * renderer must say *unclassified* rather than filing it under the first band.
   */
  readonly band?: string;

  /**
   * Whether the baseline this render was measured against carried this too.
   *
   * `true` is *you inherited this*; `false` is *this arrived with the change you
   * are reviewing*. Inspection reads one render with no baseline, which is the
   * whole reason it can see a defect a comparison never will — and the cost is
   * that its output is identical on the run that introduced a defect and on the
   * two hundred runs after it. A reviewer with no answer here reads the same list
   * every time and stops reading it.
   *
   * **Absent is neither.** It means nothing recorded what the baseline contained:
   * no baseline yet, a baseline written before `Raster.findingMarks` existed, or
   * a store that does not carry it. A surface that printed absent as `false`
   * would announce every standing defect in the suite as newly introduced, on the
   * first run after an upgrade, to the person least able to check.
   */
  readonly standing?: boolean;
  /** One sentence, naming the thing rather than the rule. */
  readonly what: string;
  readonly path: string;
  /** Landmark phrase, e.g. `main → list item 2 of 3`. */
  readonly where?: string;
  readonly component?: string;
  readonly file?: string;
}
