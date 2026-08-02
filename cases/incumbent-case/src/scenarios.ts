/**
 * The corpus: eight edits, and what each arm is expected to tell a reviewer.
 *
 * Declared here, in one file, importable by both runners and owned by neither —
 * so the expected answers are fixed before either arm runs and a disagreement
 * cannot be settled afterwards by adjusting the scoreboard. This is the
 * discipline the M0 measurement used against the kitchen-sink corpus
 * (`docs/context/journal/0006-m0-measurement.md`), pointed at a competitor
 * instead of at ourselves.
 *
 * **The ground truth is not "did the image change".** It is *must a reviewer be
 * told?* Those are different questions, and every row where they come apart is a
 * row where one of the two arms is wrong:
 *
 * - an `aria-label` deleted from an icon-only control changes no pixel and is a
 *   defect that ships
 * - a formatter reindenting JSX changes no rendering and is not a defect at all
 *
 * A corpus built on "did the image change" cannot contain either row, which is
 * exactly why pixel tools are usually evaluated against corpora that do not.
 */

/**
 * One edit to the panel, as a set of overrides.
 *
 * Variants are props rather than second copies of the markup: both arms must
 * observe the same component tree, and two hand-written copies of a panel would
 * make every measurement a story about which copy drifted.
 */
export interface Edit {
  /** `false` drops the label from the icon-only control. Renders identically. */
  readonly labelled?: boolean;
  /** `div` demotes the heading while keeping every rendered property. */
  readonly heading?: 'h2' | 'div';
  /** `div` devolves the row control to a non-focusable, roleless element. */
  readonly control?: 'button' | 'div';
  /** Rows in the list. More rows means a taller subject. */
  readonly rows?: number;
  /** The spacing token, in px. Moves boxes. */
  readonly space?: number;
  /** `false` removes the unsaved-changes dot, without moving anything around it. */
  readonly indicator?: boolean;
  /** `true` renders the note the way a formatter leaves it after reindenting. */
  readonly reindented?: boolean;
}

export const BASE = {
  labelled: true,
  heading: 'h2',
  control: 'button',
  rows: 3,
  space: 12,
  indicator: true,
  reindented: false,
} as const satisfies Required<Edit>;

/**
 * What an arm told a reviewer.
 *
 * Three outcomes, not pass/fail, because `deferred` is neither. An arm that says
 * *there is no baseline for this* has done something an arm reporting a pass has
 * not, and collapsing the two is the exact failure this project refuses at every
 * other layer (`absent is not empty`).
 */
export type Told =
  /** Reported something a reviewer has to act on. The build is red. */
  | 'told'
  /** Reported nothing. The build is green. */
  | 'silent'
  /** No baseline existed, and it said so rather than answering. */
  | 'deferred';

/**
 * What the reviewer holds afterwards, which is the column replacement turns on.
 *
 * Both arms can say *something changed*. Only one of them can say *what*, and a
 * finding nobody can assign is a finding nobody acts on — which is how review
 * blindness starts and why the hundredth screenshot in a run is approved
 * unread.
 */
export type Handed =
  | 'nothing'
  /**
   * A differing-pixel count, and an image to go and look at.
   *
   * This is the whole of what a screenshot assertion can produce, including when
   * the two images are different sizes — `toHaveScreenshot` prints both
   * dimensions and then a count over the padded canvas. Predicted here as a
   * refusal to measure, which is what older write-ups describe; the run says
   * otherwise, and the run wins. See the README.
   */
  | 'a number'
  /** No baseline to compare against. */
  | 'no baseline'
  /** Components, ranked cause before collateral, each resolved to a file. */
  | 'components and files';

/** Scoring a `Told` against the ground truth. Derived, never declared. */
export type Mark = 'hit' | 'miss' | 'hold' | 'false alarm' | 'deferral';

export function mark(regression: boolean, told: Told): Mark {
  if (told === 'deferred') return 'deferral';
  if (regression) return told === 'told' ? 'hit' : 'miss';
  return told === 'told' ? 'false alarm' : 'hold';
}

export interface Expectation {
  readonly told: Told;
  readonly handed: Handed;
}

export interface Scenario {
  readonly id: string;
  /** The edit, as a developer would describe it in a commit message. */
  readonly edit: string;

  /**
   * Ground truth: must a reviewer be told?
   *
   * Decided by argument before either arm ran, with the argument in
   * {@link Scenario.why} so it can be disputed rather than merely disbelieved.
   */
  readonly regression: boolean;
  readonly why: string;

  readonly before: Edit;
  readonly after: Edit;

  /** `none` is the new-subject case, which neither arm may call a pass. */
  readonly baseline: 'recorded' | 'none';

  readonly expect: {
    /** The incumbent at its shipped defaults: any differing pixel fails. */
    readonly strict: Expectation;
    /** The incumbent at the tolerance a team sets to survive a real suite. */
    readonly tolerant: Expectation;
    readonly ours: Expectation;
    /** The component our arm must name, or `null` where we have nothing to name. */
    readonly names: string | null;
  };
}

const NOTHING = { told: 'silent', handed: 'nothing' } as const;
const NO_BASELINE = { told: 'deferred', handed: 'no baseline' } as const;
const A_NUMBER = { told: 'told', handed: 'a number' } as const;
const NAMED = { told: 'told', handed: 'components and files' } as const;

/**
 * Rows 1–3: the category no raster tool can observe, at any threshold, ever.
 * Row 4: the tolerance that suppresses flake suppressing the regression.
 * Row 5: seen by both, actionable by one.
 * Rows 6–7: what each arm does when it cannot compare.
 * Row 8: the row where we lose.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'label-dropped',
    edit: 'remove the aria-label from the icon-only refresh control',
    regression: true,
    why:
      'The control is a glyph. Without the label a screen reader announces ' +
      '"button" and the action is unreachable to anyone not looking at it. ' +
      'Nothing about the rendering changes, so no image can carry this.',
    before: {},
    after: { labelled: false },
    baseline: 'recorded',
    expect: { strict: NOTHING, tolerant: NOTHING, ours: NAMED, names: 'IconButton' },
  },
  {
    id: 'heading-demoted',
    edit: 'change the panel heading from <h2> to a styled <div>',
    regression: true,
    why:
      'Every rendered property is carried across, so the two paint the same ' +
      'pixels. The document outline loses a level and heading navigation skips ' +
      'the panel.',
    before: {},
    after: { heading: 'div' },
    baseline: 'recorded',
    expect: { strict: NOTHING, tolerant: NOTHING, ours: NAMED, names: 'Heading' },
  },
  {
    id: 'control-devolved',
    edit: 'swap the row <button> for a <div> with a click handler',
    regression: true,
    why:
      'The most common accessibility regression there is, and the one reviews ' +
      'miss most reliably: the styling is copied across faithfully, so it looks ' +
      'correct and is no longer focusable, has no role, and ignores Enter.',
    before: {},
    after: { control: 'div' },
    baseline: 'recorded',
    expect: { strict: NOTHING, tolerant: NOTHING, ours: NAMED, names: 'RowAction' },
  },
  {
    id: 'indicator-dropped',
    edit: 'remove the unsaved-changes indicator from the toolbar',
    regression: true,
    why:
      'A status dot vanishes and nothing around it moves. Plainly visible, so ' +
      'this is the case a pixel differ is built for — and small, which is the ' +
      'whole point: a tolerance is a fraction of the *image*, so the budget a ' +
      'team sets to survive antialiasing is larger than the indicator.',
    before: {},
    after: { indicator: false },
    baseline: 'recorded',
    // The row the two incumbent configurations disagree on, which is the
    // argument: the setting that makes the suite survivable is the setting that
    // hides this.
    //
    // `Indicator` rather than `Toolbar`, which was the prediction. Attribution
    // names the component that owns the node, not the one that contains the
    // region — so it was more precise than the declaration, and the declaration
    // moved. See the README.
    expect: { strict: A_NUMBER, tolerant: NOTHING, ours: NAMED, names: 'Indicator' },
  },
  {
    id: 'space-token-nudged',
    edit: 'nudge the spacing token from 12px to 14px',
    regression: true,
    why:
      'A real change, and one both arms see. This row does not ask about ' +
      'detection — it asks what the reviewer is handed afterwards, when one edit ' +
      'has displaced everything below it.',
    before: {},
    after: { space: 14 },
    baseline: 'recorded',
    expect: { strict: A_NUMBER, tolerant: A_NUMBER, ours: NAMED, names: 'Panel' },
  },
  {
    id: 'row-added',
    edit: 'add a fourth row, which makes the panel taller',
    regression: true,
    why:
      'Content grew, which is the ordinary consequence of an ordinary edit. Both ' +
      'arms detect it. What separates them is that a count taken over a padded ' +
      'canvas is dominated by everything the insertion pushed downwards, so the ' +
      'number describes the displacement rather than the edit.',
    before: {},
    after: { rows: 4 },
    baseline: 'recorded',
    expect: { strict: A_NUMBER, tolerant: A_NUMBER, ours: NAMED, names: 'Row' },
  },
  {
    id: 'unseen-subject',
    edit: 'add a panel nobody has a baseline for',
    regression: false,
    why:
      'Not a regression and not a pass. There is nothing to compare against, and ' +
      'an arm reporting either verdict has invented one. Both arms get this ' +
      'right, and it is in the corpus because a comparison that only lists ' +
      'disagreements is an advertisement.',
    before: {},
    after: {},
    baseline: 'none',
    expect: { strict: NO_BASELINE, tolerant: NO_BASELINE, ours: NO_BASELINE, names: null },
  },
  {
    id: 'note-reindented',
    edit: 'let a formatter reindent the note, wrapping its inline children',
    regression: false,
    why:
      'Nothing renders differently: leading and trailing whitespace inside a ' +
      'block collapses away. Telling a block context from an inline one needs a ' +
      'layout engine and the normalizer does not consult one, so we report a ' +
      'change that is not there. The camera is right and we are wrong.',
    before: {},
    after: { reindented: true },
    baseline: 'recorded',
    expect: {
      strict: NOTHING,
      tolerant: NOTHING,
      // Declared as the failure it is, so the suite goes red the day it stops
      // being true — which is the day somebody fixed it.
      ours: { told: 'told', handed: 'components and files' },
      names: 'Note',
    },
  },
];

export function scenario(id: string): Scenario {
  const found = SCENARIOS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`unknown scenario: ${id}`);
  return found;
}

export type Variant = 'before' | 'after';

export function editFor(candidate: Scenario, variant: Variant): Required<Edit> {
  return { ...BASE, ...(variant === 'before' ? candidate.before : candidate.after) };
}

/**
 * The two incumbent configurations, and why there are two.
 *
 * Running only the shipped defaults would be a straw man in our favour — they
 * fail on a single differing pixel, which no real suite survives, so a team would
 * rightly say we tested a configuration nobody uses. Running only the tolerant
 * one would be a straw man in theirs. Both are run, and the rows where they
 * disagree are the measurement.
 */
export interface Configuration {
  readonly id: 'strict' | 'tolerant';
  readonly summary: string;
  /** `undefined` means the option is left at Playwright's own default. */
  readonly maxDiffPixelRatio: number | undefined;
}

export const CONFIGURATIONS: readonly Configuration[] = [
  {
    id: 'strict',
    summary: 'shipped defaults — one differing pixel fails',
    maxDiffPixelRatio: undefined,
  },
  {
    id: 'tolerant',
    summary: 'maxDiffPixelRatio 0.01 — the setting a real suite runs',
    maxDiffPixelRatio: 0.01,
  },
];
