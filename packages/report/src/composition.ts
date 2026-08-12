/**
 * The suite as one graph, in the artifact.
 *
 * Every other part of a run report is *one subject against its baseline* — two
 * revisions, one thing. This is the other axis, and it is the one a suite of
 * examples has always implied and never written down:
 *
 * > A visual-regression example is a component built from components. The example
 * > *is* a component, at a boundary; the same component appears again, with the
 * > same or different props, inside larger examples.
 *
 * Once the boundaries are addressable, the run can say which of its examples are
 * watching literally the same bytes, which of them disagree at one commit, and —
 * for anything that moved — what in the run explains it. None of that needs a
 * second render, a second image, or a store: it is a fold over digests the
 * collection already produced.
 *
 * ## Why the shapes here are smaller than the ones that produced them
 *
 * `@variance-authority/core`'s `Composition` carries every site of every
 * rendering, which is one entry per component boundary per subject — tens of
 * thousands of objects on a real suite, and a report is a file people open. What
 * survives into the artifact is what a *sentence* needs: the names, the counts,
 * and the subject lists that let a reader go and look. A consumer that wants the
 * full graph recomputes it from the snapshots, which is the same bargain the
 * report already makes about masks and PNGs.
 *
 * The one thing kept in full is the movement list, because it is short by
 * construction — only components that moved — and because it is the part somebody
 * acts on.
 */

/** A component's census entry: where it is, what it is inside, what it reads. */
export interface ComponentRecord {
  readonly component: string;
  /** Subjects holding at least one boundary of it, in plan order. */
  readonly subjects: readonly string[];
  /** Boundaries summed across every subject. Distinct from `subjects.length`. */
  readonly instances: number;

  /**
   * Subjects whose shallowest attributed boundary is this component.
   *
   * The narrow example — the subject that exists to *show* this thing rather than
   * a page that happens to contain it. Empty is a real answer and a common one: a
   * component that appears only inside pages has no example, which is the gap a
   * reviewer is usually looking for.
   */
  readonly examples: readonly string[];

  /** Components that enclose it somewhere, sorted. The graph, upwards. */
  readonly within: readonly string[];

  /**
   * Components that **mounted** it somewhere, sorted. Usually the useful edge.
   *
   * `within` is where the boundary sits and this is who wrote the element, and in
   * a real application they are mostly different: measured on
   * `examples/todomvc`, every `Chip` is `within: ["Stack"]` and
   * `createdBy: ["TodoFooter"]`. `TodoFooter` renders nothing but other
   * components, so it owns no DOM node, is a boundary nowhere, and would be
   * absent from this graph entirely if only `within` were recorded — while being
   * the file a reviewer has to open.
   *
   * Empty on a production build, where React's `_debugOwner` is gone. Empty is
   * *not* "nothing mounted it".
   */
  readonly createdBy: readonly string[];

  /** Components it encloses somewhere, sorted. The graph, downwards. */
  readonly renders: readonly string[];
  /** Custom properties its own nodes resolve through, anywhere in the suite. */
  readonly tokens: readonly string[];

  /**
   * Distinct props digests it was rendered with, and distinct renderings it
   * produced.
   *
   * Two numbers rather than the classes themselves, because the classes are
   * digests and a digest tells a human nothing. What the pair says is worth a
   * line: `variants: 4, renderings: 4` is a component whose output is a function
   * of its input, and `variants: 1, renderings: 3` is one whose output is not —
   * which is what `divergences` is about.
   *
   * `variants` counts the unknown-props class as one when it occurred, because
   * instances with no provenance are a group this report can describe and not one
   * it may join on.
   */
  readonly variants: number;
  readonly renderings: number;
}

/**
 * One rendering, several subjects. The dots, connected.
 *
 * The finding is a rendering that survives being mounted somewhere else — three
 * identical chips in one list say nothing, and the same chip in a chip story and
 * in a page footer says that a reviewer looking at two diffs is looking at one.
 */
export interface EchoRecord {
  readonly component: string;
  /** The joining digest: the four content digests of the boundary, together. */
  readonly rendering: string;
  /** At least two, in plan order. */
  readonly subjects: readonly string[];
  /** Boundaries, which is at least `subjects.length`. */
  readonly sites: number;
  /** The narrow example among them, when the suite has one. */
  readonly example?: string;
}

/**
 * The same component, the same **inputs**, more than one rendering. At one commit.
 *
 * Not a regression — there is no baseline anywhere in it. It says the component's
 * own inputs do not determine its output, which is either a fact about the design
 * (a token, a theme, an ancestor's cascade) or a reading that is not repeatable.
 * `bands` says which kind, in the vocabulary a sensitivity absorbs, so a
 * divergence entirely inside a relaxed band can be dismissed without opening it.
 *
 * *Inputs*, not *props*: a props digest excludes `children`, and `divergencesOf`
 * in `core` refuses every pair the exclusion could explain. An empty list is a
 * real and common answer — `examples/todomvc` produces exactly zero — and it
 * means nothing in the suite rendered two ways from one input.
 */
export interface DivergenceRecord {
  readonly component: string;
  readonly bands: readonly string[];
  /** How many distinct renderings one props digest produced. At least two. */
  readonly renderings: number;
  /** Subjects involved, in plan order. */
  readonly subjects: readonly string[];
}

/**
 * Why one component moved in one subject, and what the suite held against it.
 *
 * The ladder is `edited` → `token` → `upstream` → `contradicted` → `unexplained`,
 * and the last one is the finding. See
 * [`flakiness.md`](../../../docs/flakiness.md) for what it is and is not allowed
 * to conclude.
 */
export interface MovementRecord {
  readonly subject: string;
  readonly component: string;
  /** Empty means *not known* — a name-only comparison — never *no band*. */
  readonly bands: readonly string[];
  readonly cause: 'edited' | 'token' | 'upstream' | 'contradicted' | 'unexplained';
  /** One sentence, naming the evidence rather than the category. */
  readonly because: string;

  readonly file?: string;
  readonly tokens?: readonly string[];
  readonly upstream?: string;

  /** Other subjects this same component moved in. The "one cause, N subjects" fold. */
  readonly alsoIn: readonly string[];

  /**
   * Subjects where the same component, with the same props, did **not** move.
   *
   * The control group — the *stable states to refer to*. Empty means the suite
   * offered no control, which weakens an unexplained movement rather than
   * strengthening it, and is why this is a list and not a flag.
   */
  readonly held: readonly string[];

  /**
   * For an unexplained movement only: whether the subject was already proven
   * unstable in this run.
   *
   * `flake` means the subject failed to read the same way twice *and* nothing in
   * the run explains what moved — the two halves of the sentence, together, for
   * the first time. `suspect` means nobody has read it twice yet, so it is a
   * shortlist entry and not a verdict.
   *
   * Absent on every explained movement, where the question does not arise.
   */
  readonly standing?: 'flake' | 'suspect';
}

/**
 * What one run learned by comparing its subjects to each other.
 *
 * Absent from a report whose collection produced no semantic snapshots — a
 * raster-only tier has no boundaries to join, and an empty graph would read as
 * "this suite shares nothing", which is a different and false claim.
 */
export interface CompositionReport {
  /** Subjects that contributed a snapshot, in plan order. The denominator. */
  readonly subjects: readonly string[];
  /** Sorted by name, code-unit order. */
  readonly components: readonly ComponentRecord[];
  /** Widest first. Capped — see `truncated`. */
  readonly echoes: readonly EchoRecord[];
  /** Sorted by component name. */
  readonly divergences: readonly DivergenceRecord[];
  /** Every component the run found moved, in the order the observations came. */
  readonly movements: readonly MovementRecord[];

  /**
   * What was left out of the lists above, when anything was.
   *
   * A cap that says nothing is a cap that reads as coverage. Present only when a
   * list was shortened, and counts what did not make it rather than what did.
   */
  readonly truncated?: {
    readonly echoes: number;
  };
}
