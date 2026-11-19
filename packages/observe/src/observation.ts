import type {
  AttributedRegion,
  ComponentBands,
  Isolation,
  SourceIndex,
} from '@variance-authority/core/attribute';
import type { Band } from '@variance-authority/core/compare';
import type {
  AccessibilitySnapshot,
  Diagnostic,
  SemanticSnapshot,
  StepClock,
} from '@variance-authority/core/format';
import type { Level } from '@variance-authority/core/judge';
import type { ComparedPixels, PngDecoder } from '@variance-authority/png';
import type {
  CompareOptions,
  RasterComparison,
  RasterStore,
  Renderer,
} from '@variance-authority/raster';

/** What one comparison found, and the inputs every way of reaching it shares. */

export type RasterVerdict =
  | 'unchanged'
  | 'changed'
  /** No baseline for this subject. Not a pass, and not a failure. */
  | 'new'
  /**
   * Pixels differed, and every one of them fell inside something the operator
   * excluded (spec 0024).
   *
   * A word of its own rather than `unchanged`, and the distinction is the whole
   * reason ignores are safe to have. It exits `0` — the operator declared this is
   * not the subject, and nothing needs review — while remaining countable, so a
   * suite can be asked how many of its green subjects are green because nobody
   * looked. `unchanged` cannot answer that question and would never be asked it.
   */
  | 'ignored';

export interface Observation {
  readonly subject: string;
  readonly verdict: RasterVerdict;
  /** One sentence stating what happened and why it has this verdict. */
  readonly because: string;

  readonly comparison?: RasterComparison;
  readonly isolation?: Isolation;
  /** Empty unless a snapshot was supplied — geometry alone cannot name a node. */
  readonly regions: readonly AttributedRegion[];

  /** `false` when the image came from the cache rather than from a renderer. */
  readonly rendered: boolean;
  /** Fonts the document declared and the renderer did not have. */
  readonly missingFonts: readonly string[];

  /**
   * The three independently observed boundaries and the retained ARIA diff.
   *
   * A missing member was not measured. A subject compared across two render
   * identities carries `identity` and `moved`: the cause of whatever the
   * comparison found (ADR-0090).
   */
  readonly signals?: {
    readonly document: 'unchanged' | 'changed';
    /**
     * Set when the two images were painted under different identities: `recipe`
     * when they differ in the recipe digests alone (`recipeOnly`), `machine` for
     * any other difference, including one nobody recorded.
     */
    readonly identity?: 'recipe' | 'machine';
    /** The identity fields that moved, as `field a → b`, stored side first. */
    readonly moved?: readonly string[];
    /**
     * `unobservable` when the subject occupies no pixels — a wrapper whose only
     * child went to a portal, a mount with no children. Distinct from
     * `unchanged`, which is a measurement that found nothing moved: here there
     * was nothing to measure, and a reader that saw `unchanged` would take the
     * image as evidence it never was.
     */
    readonly pixels?: 'unchanged' | 'changed' | 'unobservable';
    readonly accessibility?: {
      readonly verdict: 'unchanged' | 'changed';
      readonly before?: AccessibilitySnapshot;
      readonly after?: AccessibilitySnapshot;
    };
    /**
     * `unrecorded` when this run collected a snapshot and the stored baseline
     * it was compared against kept none that unpacks, whatever the verdict.
     * Never set against an image the caller handed in, which nothing stores. A changed
     * region is joined against that side's nodes, so an accepting run re-stamps
     * an unchanged baseline that carries this, as it re-stamps one painted under
     * another identity: left alone, the first change after it is joined against
     * one render.
     */
    readonly snapshot?: 'unrecorded';
    /**
     * Set when the baseline was read from where the layout before
     * `baselines.path` kept it, root-relative and without an extension: `from`
     * the old place, `to` the path the configured template renders. A cause,
     * never a reason to call the subject `new`, and an accepting run re-stamps
     * an unchanged baseline that carries it, which is the move.
     */
    readonly relocated?: { readonly from: string; readonly to: string };
  };

  /**
   * What the operator's ignores took out of this comparison.
   *
   * Present whenever the snapshot carried an excluded subtree, including when it
   * absorbed nothing — because "this run had ignores and they caught nothing" is
   * the state that turns a rule into a blind spot, and a field that vanishes when
   * the count is zero cannot report it.
   */
  readonly ignored?: IgnoredPixels;

  /**
   * The sensitivity that absorbed this subject, and the bands it absorbed.
   *
   * Present only when a declaration decided the verdict — which is what makes it
   * the input a register is built from. The `because` string carries the same
   * facts in prose for a person, and a run that had to parse that prose back out
   * to count anything would be one edit away from counting nothing.
   *
   * Absent on a subject a sensitivity applied to and did *not* absorb, because
   * nothing was relaxed there; the rule's own presence in the config is what
   * lets the register still name it as having absorbed zero.
   */
  readonly relaxed?: {
    readonly rule: string;
    readonly level: Level;
    readonly bands: readonly Band[];
  };

  /**
   * Components whose own content differs from the baseline's (spec 0017).
   *
   * The list `rankRegions` needs, and the reason a baseline carries its component
   * hashes. Without it the ordering falls back to area, which measures
   * displacement rather than cause — an edit that reflows its surroundings moves
   * far more of them than of itself, so the component nothing edited outranks the
   * one that was.
   *
   * Absent when either side has no hashes to compare: a baseline written before
   * they existed, a store that dropped them, or a run with no snapshot. Absent
   * means *unknown*, and a caller must not read it as "nothing caused this".
   */
  readonly causes?: readonly string[];

  /**
   * The same comparison unfolded: every component whose hashes moved, and how.
   *
   * `causes` names them; this says in what sense each one differs — a colour is
   * `token`, a size is `geometry`, a string is `content`, an accessible name is
   * `a11y`. It is a superset, because a component pushed by a neighbour without
   * editing itself is a movement and not a cause, and it carries `cause` per
   * entry so nothing downstream has to re-derive the distinction from bands that
   * cannot express it.
   *
   * Present and absent under exactly the same condition as `causes`, which is
   * why one function produces both. Absent means no baseline hashes, not "no
   * component moved".
   */
  readonly moved?: readonly ComponentBands[];

  /**
   * What this comparison could not do, or did under a condition worth stating.
   *
   * Beside `causes` rather than folded into `because`, for the reason every other
   * diagnostic in this system is a field: a sentence is read once and a code can
   * be counted across a suite. `recordOf` merges these with the collector's own,
   * so a reader meets one list per subject.
   */
  readonly diagnostics?: readonly Diagnostic[];
}

export interface IgnoredPixels {
  /** Changed pixels that fell inside an excluded box. */
  readonly pixels: number;
  /** Boxes that were excluded. Counted, not listed, so a report stays readable. */
  readonly boxes: number;
  /** Boxes covering no changed pixel: the raster half of a dead ignore. */
  readonly inert: number;

  /**
   * Pixels each rule absorbed here, by rule id.
   *
   * A rule present with `0` is the whole reason this is a map rather than a
   * total: a run-level register has to be able to say "`carousel` excluded a
   * subtree in 40 subjects and absorbed nothing in any of them", and a field that
   * only records what was caught can never report a rule that caught nothing.
   */
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Everything a comparison needs that is not a renderer and not a store.
 *
 * Split out because it is a fact about this system worth being able to point at:
 * **the deciding half needs neither.** `decide` reads a snapshot, a policy, a
 * decoder and a set of declarations, and never once asks who painted the images
 * or where they were kept — it was written against `ObserveOptions` only because
 * that is what its callers happened to have.
 *
 * Naming the smaller set makes comparison available to callers that already own
 * both rasters. Every supplied field is still honoured. Evidence a raster-only
 * caller cannot supply — snapshot, exclusions, attribution, and bands — remains
 * absent rather than being guessed.
 */
export interface CompareInputs {
  /**
   * The normalized snapshot of the same render.
   *
   * Optional, and the whole reason to bother. Without it an observation is a
   * pixel count with coordinates — the state of the art, and unassignable. With
   * it every region carries the node it landed on, the component that produced
   * that node, and the landmark path someone would use to describe where it is.
   */
  readonly snapshot?: SemanticSnapshot;
  /** Browser-native accessibility evidence from this acquisition. */
  readonly accessibility?: AccessibilitySnapshot;
  readonly source?: SourceIndex;

  readonly compare?: CompareOptions;

  /**
   * How much of this subject is being asserted on, if it has been relaxed.
   *
   * Resolved by the caller, because scoping is a question about subject ids and
   * tags and this function has one subject and no plan. What arrives is the rule
   * that applies *here*, already matched, or nothing.
   *
   * It decides against the bands the two revisions' component hashes disagree
   * on, which is what a stored baseline can answer for — see `absorbsEntirely`.
   * A baseline carrying no hashes therefore absorbs nothing and the subject is
   * reported in full, which is the correct direction: a declaration that cannot
   * be evaluated must not be assumed to have been satisfied.
   */
  readonly sensitivity?: {
    readonly rule: string;
    readonly reason: string;
    readonly level: Level;
  };

  /**
   * How PNG bytes become pixels. Defaults to `pngjs`, which requires nothing.
   *
   * Decoding is 90% of a comparison (journal 0016), so this is the single
   * largest lever on raster cost — `@variance-authority/png-sharp` measures 1.5×
   * per image and 12× when several decode at once, because libvips runs off the
   * event loop. It is a separate package because it is a native addon, and a
   * consumer that cannot load one keeps the default rather than losing the
   * comparison.
   */
  readonly decoder?: PngDecoder;
  /**
   * Given the two decoded images and their row pairing, for a caller that draws
   * from them next. A callback rather than a field: an observation carries no
   * pixels, and a caller holding several would hold every page decoded.
   */
  readonly keep?: (pixels: ComparedPixels) => void;
  /** Grid at which neighbouring changed pixels count as one place. */
  readonly cell?: number;
  readonly limit?: number;

  /**
   * Difference shapes to absorb, as `fingerprint → rule id` (spec 0024).
   *
   * The half of an ignore that a place cannot express: a flake that moves has no
   * stable node to name, and a rectangle drawn where it was last seen silences
   * whatever lands there next. A shape follows the artifact instead, so a
   * *different* regression in the same place still has a different fingerprint
   * and is still reported.
   *
   * Applied after isolation, because a fingerprint is a property of a clustered
   * region rather than of a pixel — which also means it can only absorb what the
   * isolation actually returned, and a truncated tail is never silently absorbed.
   */
  readonly ignoreShapes?: Readonly<Record<string, string>>;

  /**
   * Where this observation's steps are taken: `baseline` (the store lookup),
   * `cache.get` and `cache.put` (the render cache), the renderer's own steps
   * under `render.`, then `decode` and `compare`. Absent, nothing is timed.
   */
  readonly steps?: StepClock;
}

/** {@link CompareInputs}, plus the two things a render needs. */
export interface ObserveOptions extends CompareInputs {
  readonly renderer: Renderer;
  readonly store: RasterStore;
}
