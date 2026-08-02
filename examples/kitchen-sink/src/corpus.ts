/**
 * The manifest of expectations — the corpus's actual product.
 *
 * M0's exit criterion is *"is normalization quality achievable?"*, and its targets
 * are numbers: `<2% false semantic misses on no-op refactors`, `0 baseline breakage
 * across rebase` (spec §10). A number needs a denominator, and a denominator needs
 * a set of renders whose correct answer was fixed **before** anyone looked at what
 * the normalizer produced. That is this table. Written after the fact it would
 * measure nothing: any ruleset scores 100% against expectations derived from its
 * own output.
 *
 * So each row states a ground truth and, in `rationale`, the argument for it. The
 * rationale is not documentation. It is the thing a future reader disputes when
 * they think a case is wrong — and some of these *are* arguable, which is why
 * `contested` exists rather than a confident answer. A corpus that never admits
 * uncertainty is a corpus that has been fitted to an implementation.
 *
 * What this table does not contain: expected hashes. Hashes are the normalizer's
 * output and belong to whatever measures it. This file only says whether two
 * renders should agree.
 */

import type { Band, ProfileId } from '@variance-authority/core';
import type { SubjectId } from './subjects.js';
import type { VariantId } from './variants.js';

/** `texture` is excluded: it is raster residue, and nothing here reaches raster. */
export type ExpectedBand = Exclude<Band, 'texture'>;

export type Verdict = 'hash-stable' | 'hash-changed';

/**
 * A different, equally correct answer under one profile (ADR-0008 state 2).
 *
 * Replaces the default clause wholesale rather than patching it, so a reader
 * never has to compose two partial expectations to know what is being claimed.
 */
export interface ProfileExpectation {
  readonly expect: Verdict;
  readonly band?: ExpectedBand;
  readonly roots?: number;
  /**
   * The argument for the divergence — mandatory, because a divergence with no
   * stated reason is indistinguishable from a mistake, and the whole point of
   * declaring the legitimate ones is to leave the illegitimate ones exposed.
   */
  readonly because: string;
}

/**
 * The profile is structurally unable to decide this case (ADR-0008 state 1).
 *
 * Excluded from that profile's score in both directions. A profile is not
 * credited for an answer it reached by not looking, and not charged for a
 * limitation its `ObservationProfile` already declares.
 */
export interface Undecidable {
  readonly undecidable: string;
}

export type ProfileClause = ProfileExpectation | Undecidable;

export interface CorpusCase {
  readonly id: string;
  /** Which component fixture. */
  readonly subject: SubjectId;
  readonly baseVariant: VariantId;
  readonly perturbedVariant: VariantId;
  /**
   * The answer under any profile that has not said otherwise — not "the `jsdom`
   * answer". A profile-specific answer goes in {@link CorpusCase.byProfile}.
   */
  readonly expect: Verdict;
  /** Set when `hash-changed`. */
  readonly band?: ExpectedBand;
  /** Why this is the ground truth — the argument, not a description. */
  readonly rationale: string;
  /** Which ADR or spec section this case defends. */
  readonly spec: string;

  /**
   * Expected number of docket roots (spec §6.2). Almost always 1: "one root plus
   * counted collateral" is claim P2, and a differ that reports N roots for one
   * cause has failed even with a correct hash.
   */
  readonly roots?: number;
  /**
   * Lower bound on collateral nodes. A bound rather than an exact count because
   * the exact number depends on the computed-style allowlist, which is versioned
   * and expected to move; the bound is what distinguishes narrow fan-out from
   * wide, which is the thing being measured.
   */
  readonly minCollateral?: number;
  /**
   * Set when the ground truth is genuinely disputable. A harness MUST NOT count
   * contested cases toward a pass rate without saying so — they are discussion
   * items, and reporting them as failures or as successes both hide the fact that
   * nobody has decided.
   */
  readonly contested?: string;

  /**
   * Per-profile overrides (ADR-0008).
   *
   * Absent for a profile means the default {@link CorpusCase.expect} holds there.
   * Present it is either an {@link Undecidable} — exclude the case from that
   * profile's score — or a {@link ProfileExpectation}, meaning the profiles
   * legitimately disagree and both answers are correct.
   *
   * Those two are not the same thing and are never collapsed: exclusion says the
   * profile cannot see the case, divergence says it sees it differently. A third
   * situation — the profiles disagreeing when nothing here says they should — is
   * not declarable at all. It is the observation P4 exists to make.
   */
  readonly byProfile?: Readonly<Partial<Record<ProfileId, ProfileClause>>>;
}

export const CORPUS: readonly CorpusCase[] = [
  // ===========================================================================
  // P1 — no-op refactors. Expected: the hash does not move.
  // ===========================================================================

  {
    id: 'class-churn/button',
    subject: 'button',
    baseVariant: 'base',
    perturbedVariant: 'class-churn',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1 (class attributes are not in the semantic snapshot)',
    rationale:
      'Only the salt fed to the class-name generator changed. Every declaration block ' +
      'emitted is byte-identical, so every resolved computed value is identical, so ' +
      'nothing a user or a screen reader can perceive differs. The names themselves ' +
      'record how a style was applied, not what was applied, and the snapshot already ' +
      'records the resolved what. In a real repo this perturbation is produced by ' +
      'editing an unrelated sibling component — the class hash is a function of file ' +
      'contents, not of the rule it names — so treating it as a change means every ' +
      'baseline in the repository invalidates on every CSS-in-JS edit anywhere.',
  },
  {
    id: 'class-churn/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'class-churn',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1',
    rationale:
      'Same perturbation as `class-churn/button`, on a subject whose generated classes ' +
      'coexist with hand-written ones (`ks-card`, `ks-card__body`). The pair matters: a ' +
      'normalizer that dropped only names matching a generated-looking pattern would ' +
      'pass the Button case and could still churn here when the two kinds of name sit ' +
      'in the same `class` attribute. ADR-0003 does not classify class names, it drops ' +
      'the attribute, and this is where those two policies diverge.',
  },
  {
    id: 'class-churn/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'class-churn',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1; spec §6.2',
    rationale:
      'Hero declares no generated classes of its own; all the churn is in its children. ' +
      'If a hash moves here it localizes the defect to propagation through a composition ' +
      'boundary rather than to the leaf components, because the leaf cases (`button`, ' +
      '`card`) cover the leaves and the difference between the results is the evidence.',
  },
  {
    id: 'id-shift/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1 (structural aliasing)',
    rationale:
      "React's client `useId` draws from a module-global counter, so which stories a " +
      'developer opened first decides the ids in this one. Every id here changed value; ' +
      'no relationship changed — `for` still names the input, `aria-describedby` still ' +
      'names the help text. Aliasing in document order maps both renders onto the same ' +
      '`#a0`/`#a1` shape. The ground truth is not "ids are unimportant": it is that the ' +
      'accessible relationship survived intact, which is exactly what a user of the form ' +
      'experiences. The paired case `break-association/field` shows the same normalizer ' +
      'must not call *those* renders equal.',
  },
  {
    id: 'id-shift/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1; `ID_REFERENCE_LIST_ATTRIBUTES`',
    rationale:
      'Tabs route their renumbered ids through `aria-controls` and `aria-labelledby`, ' +
      'which are space-separated reference *lists*. An aliaser that rewrote single-value ' +
      'references and left list-valued ones alone passes `id-shift/field` and fails here. ' +
      'The two cases exist to be different for that one reason.',
  },
  {
    id: 'id-shift/dialog',
    subject: 'dialog',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1',
    rationale:
      'The dialog is closed in both renders, so the whole subject is inside the container ' +
      'and the portal ambiguity does not arise. Isolating renumbering from the portal ' +
      'question is the point: if `dialog-open/dialog` fails and this passes, the portal ' +
      'boundary is implicated and aliasing is not.',
  },
  {
    id: 'id-shift/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1',
    rationale:
      'Renumbering reaching a nested Field through two composition boundaries. Aliases are ' +
      'assigned in document order of first occurrence, which is a property of the whole ' +
      'subtree rather than of the component that generated the id — so this case checks ' +
      'that the aliaser walks the subject, not each component in isolation.',
  },
  {
    id: 'css-accretion/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-accretion',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 3 (rules matching no node are dropped)',
    rationale:
      'The headline claim. Between the two renders the document gained roughly fifteen ' +
      'times more CSS: harness chrome, 400 dead utility classes, and four generations of ' +
      "generated rules belonging to stories this subject never rendered. Not one of them " +
      'matches a node in the subject, so not one can affect its appearance, so none may ' +
      'affect its digest. Note that the baseline is not clean either — it already carries ' +
      'chrome and one generation of stale rules. The claim under test is the strong one: ' +
      'irrelevant CSS *growing during a session* does not move the hash. That is the shape ' +
      'the real failure takes.',
  },
  {
    id: 'css-accretion/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'css-accretion',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 3',
    rationale:
      'Same accretion against a deeper subtree with more distinct class names, so more ' +
      'opportunities for an accidental match. If this fails while `css-accretion/card` ' +
      'passes, the pruner is matching too loosely rather than not pruning at all.',
  },
  {
    id: 'css-losing-rules/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-losing-rules',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 5 (resolve the cascade; losers cannot affect the digest)',
    rationale:
      'The injected `.ks-card__body { color: #ff0000 }` (0,1,0) does match a node in the ' +
      'subject — so step 3 keeps it — and then loses the cascade to ' +
      '`.ks-card .ks-card__body` (0,2,0). A declaration that loses cannot affect the ' +
      'render, so it must not affect the hash. This is the case that separates "prune by ' +
      'matching" from "prune by matching and then resolve", and it is not academic: ' +
      'specificity churn that reshuffles losers without moving any winner is routine in ' +
      'a maturing design system, and each occurrence would otherwise invalidate baselines.',
  },
  {
    id: 'css-losing-rules/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'css-losing-rules',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 5',
    rationale:
      'The same principle where the loser is a bare type selector (`input`) rather than a ' +
      'class. Worth a second case because a matcher that buckets rules by their rightmost ' +
      'simple selector — the JSDOM strategy ADR-0003 names explicitly — handles type ' +
      'selectors on a different code path than class selectors, and the two paths can ' +
      'disagree about specificity.',
  },
  {
    id: 'css-unmatched-media/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-unmatched-media',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 2 (flatten conditionals against the declared environment)',
    rationale:
      'The added rules would visibly change the card — 40px text in bright green — if ' +
      'their conditions held. They do not: the viewport is nowhere near 99999px and ' +
      '`display: nonsense-value` is not supported. Conditions are render inputs, recorded ' +
      'in the environment key, not content to be digested. A normalizer that hashed sheet ' +
      'text would fail this while producing renders that are pixel-identical.',
  },
  {
    id: 'spelling/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'spelling-longhand',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 6; `STYLE_ALLOWLIST` (longhands only)',
    rationale:
      '`padding: 16px 16px` and four `padding-*: 16px` declarations resolve to the same ' +
      'four computed values; likewise `border-radius` and its four corner longhands. The ' +
      'allowlist admits longhands only and shorthands are expanded before matching, so ' +
      'the two renders normalize to the same declarations. The stakes are ordinary: a ' +
      'stylelint `--fix` or a Prettier-adjacent rewrite performs this edit across a whole ' +
      'repository in one commit, and it must not read as a repository-wide regression. ' +
      'Only shorthands with a clean longhand decomposition are used here; see the journal ' +
      'for the ones deliberately left out. Measured caveat: JSDOM discards a shorthand ' +
      'whose value contains `var()` while keeping the equivalent longhands, so a collector ' +
      'that trusts `getComputedStyle` under that profile sees a difference a browser does ' +
      'not. The ground truth is unaffected — the renders are identical in a real engine — ' +
      'but the expansion has to happen from the declared rule text.',
  },
  {
    id: 'spelling/button',
    subject: 'button',
    baseVariant: 'base',
    perturbedVariant: 'spelling-longhand',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 6',
    rationale:
      'The same rewrite where the declarations are emitted by the generated-class runtime ' +
      'rather than a static sheet. Expanding a shorthand also changes the generated class ' +
      'name, so this case is only a clean test of shorthand expansion if class churn is ' +
      'already handled — it depends on `class-churn/button`, and reading them together is ' +
      'how a failure here is attributed to the right rule.',
  },
  {
    id: 'wrapper-block/wrappers',
    subject: 'wrappers',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-block',
    expect: 'hash-stable',
    spec: 'spec §4.2 (non-semantic wrappers are collapsed)',
    rationale:
      'Three `<div>`s interposed in a block formatting context, carrying no role, no ' +
      'class, no padding, no border and no background. Margins collapse through them, so ' +
      'every leaf occupies the same box it did and the accessibility tree is unchanged: ' +
      'a generic `<div>` contributes no node to it. Adding and removing wrapper elements ' +
      'is among the most common refactors in a React codebase, which is what makes this ' +
      'the load-bearing case for the `<2% false semantic misses` target rather than a ' +
      'curiosity.',
  },
  {
    id: 'wrapper-block/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-block',
    expect: 'hash-stable',
    spec: 'spec §4.2',
    rationale:
      'The same three inert `<div>`s, but wrapped around a real composition rather than ' +
      'a purpose-built fixture, so the subject root itself moves three levels deeper. ' +
      'That is what a "extract this into a layout component" refactor does, and it is ' +
      'the arrangement in which node paths shift for every node in the subject at once: ' +
      'if collapse runs after path assignment rather than before, this fails while ' +
      '`wrapper-block/wrappers` — where the wrappers sit below the root — passes.',
  },
  {
    id: 'wrapper-flex-contents/wrappers',
    subject: 'wrappers',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-flex-contents',
    expect: 'hash-stable',
    spec: 'spec §4.2',
    rationale:
      'Wrappers inside a flex row, but with `display: contents`, so they generate no box ' +
      'at all and the leaves remain the flex items. This is the control for ' +
      '`wrapper-flex-block/wrappers`: same insertion, same context, and the only ' +
      'difference is one declaration that decides whether the wrapper is inert. If both ' +
      'cases produce the same verdict, the collapse rule is not consulting the box tree ' +
      'and its agreement with this case is luck.',
  },
  {
    id: 'all-cruft/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'all-cruft',
    expect: 'hash-stable',
    spec: 'ADR-0003 (all rules, composed)',
    rationale:
      'Every no-op perturbation at once — renumbered ids, renamed classes, fifteen times ' +
      'the irrelevant CSS, added losing rules, false conditionals, longhand rewrites, and ' +
      'three inserted wrappers — against the deepest subject. Cruft never arrives one kind ' +
      'at a time, and the rules interact: aliasing assigns numbers in document order, so ' +
      'running it before wrapper collapse can see a different order than running it after. ' +
      'Every individual case can pass while this fails, and that failure is about rule ' +
      'ordering rather than about any single rule.',
  },
  {
    id: 'all-cruft/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'all-cruft',
    expect: 'hash-stable',
    spec: 'ADR-0003',
    rationale:
      'The composed perturbation against the subject with the densest id references. ' +
      'Wrapper insertion moves nodes in document order while id renumbering changes the ' +
      'values being ordered; if alias assignment is order-sensitive in the wrong way, ' +
      'this is where it shows.',
  },
  {
    id: 'all-cruft/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'all-cruft',
    expect: 'hash-stable',
    spec: 'ADR-0003',
    rationale:
      'The composed perturbation against reference *lists* and ARIA state. State must ' +
      'survive normalization untouched while everything around it is rewritten; a rule ' +
      'that over-reached into `aria-selected` or the tab/panel pairing would show here ' +
      'and not in `all-cruft/field`.',
  },

  // ===========================================================================
  // Real changes. Expected: the hash moves, with a declared band.
  //
  // These are the false-negative guard. A normalizer that deleted everything
  // would score a perfect run on the section above and fail every case below,
  // which is the only reason the section above means anything.
  // ===========================================================================

  {
    id: 'css-winning-rules/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-winning-rules',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    spec: 'ADR-0003 §2 steps 3+5 (survives matching, wins the cascade)',
    rationale:
      'The injected rule has the same selector as the components sheet and arrives later, ' +
      'so it wins on document order and the body text really does turn red. Structure is ' +
      'untouched and only a resolved value moved, hence `token`. This is the exact ' +
      'counterpart of `css-losing-rules/card` and the pair is the point: the two ' +
      'perturbations differ only in specificity, so a pruner cannot pass both by being ' +
      'lenient or by being aggressive. It has to resolve the cascade.',
  },
  {
    id: 'css-matched-media/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-matched-media',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    spec: 'ADR-0003 §2 step 2',
    rationale:
      'Structurally identical to `css-unmatched-media/card` except that the condition ' +
      'holds, so the rule is hoisted and wins. Without this case, "flatten conditionals" ' +
      'would be indistinguishable from "discard anything inside an at-rule", and the ' +
      'second would score just as well while silently dropping the responsive half of ' +
      'every stylesheet it saw. Measured caveat: JSDOM does not evaluate `@media` while ' +
      'resolving styles, so this case is invisible to a collector built on ' +
      '`getComputedStyle` and can only be decided by reading `CSSMediaRule.conditionText` ' +
      'and flattening it explicitly — which is what ADR-0003 step 2 says to do anyway. ' +
      'The case is therefore a test of whether the collector implemented step 2 or ' +
      'delegated it to the engine.',
  },
  {
    id: 'token-radius/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'token-radius',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    minCollateral: 1,
    spec: 'spec §5 (token band); §6.2 (token delta ⇒ token is the root)',
    rationale:
      'One system token, `--va-radius-md`, one consumer within this subject. The narrow ' +
      'end of the collateral scale, and the reason it is in the corpus: a differ that ' +
      'reports "everything downstream" whenever a token moves would look correct on the ' +
      'wide-fan-out cases and is caught here, where the honest answer is one root and a ' +
      'handful of affected nodes.',
  },
  {
    id: 'token-card-scoped/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'token-card-scoped',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    minCollateral: 1,
    spec: 'ADR-0003 attribution side-channel (`tokenName`); `snapshot.ts` `tokens`',
    rationale:
      'The resolved radius moves by the same amount as `token-radius/card`, but the cause ' +
      'is the component-scoped `--ks-card-radius` override rather than the system scale. ' +
      'The two cases are indistinguishable if the snapshot records only resolved values, ' +
      'and produce opposite review outcomes if it records the token name: "the radius ' +
      'scale changed, 300 subjects affected" versus "this Card overrides its radius". The ' +
      'pair is what makes recording the name, and not just the value, checkable.',
  },
  {
    id: 'token-accent/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'token-accent',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    minCollateral: 2,
    spec: 'spec §6.2 (one root, counted collateral); checkpoint P2',
    rationale:
      'One custom-property value, reaching the primary Button through `background-color` ' +
      'and the secondary Button through `color`. Structure holds throughout, so `token`. ' +
      'The expected docket entry is one root — the token — with the Buttons as counted ' +
      'collateral, not two independent Button diffs. The distinction is the whole product ' +
      'claim in §1: "1 token change, 300 collateral, structure intact" has to be one ' +
      'review action, and a differ that cannot name a shared cause cannot offer one.',
  },
  {
    id: 'token-space-3/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'token-space-3',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    minCollateral: 4,
    spec: 'spec §6.2; checkpoint P2',
    rationale:
      'The wide-fan-out counterpart of `token-accent/hero`: the mid step of the spacing ' +
      "scale reaches the hero row gap, both Buttons' horizontal padding, and the nested " +
      "Field's margins. Still one root. Paired with `token-radius/card` (fan-out of one) " +
      'these bracket the collateral count, so a differ can be scored on whether it counts ' +
      'collateral or merely reports it. Under a profile with layout this also produces ' +
      'rect movement, which the attributor must fold under the same root as collateral ' +
      'rather than raise as a separate `geometry` finding.',
    byProfile: {
      chromium: {
        expect: 'hash-changed',
        band: 'geometry',
        because:
          'The rationale above already says the attributor "must fold the rect movement under ' +
          'the same root as collateral". It does fold it into one root — `roots: 1` holds — ' +
          'and it does not fold the *band*, so `geometry` is what a blocking policy reads. ' +
          'Declared here rather than argued away: under `jsdom` there is only ' +
          '`style-changed` and the answer is `token`; under `chromium` the boxes measurably ' +
          'move and `rect-changed` is louder. Both are correct readings of what each profile ' +
          'can see, which is the content of ADR-0008. This clause existed as prose in ' +
          '`docs/comparison.md` — "the other three are reported and not scored" — for as long ' +
          'as the band field asserted nothing.',
      },
    },
  },
  {
    id: 'prop-variant/button',
    subject: 'button',
    baseVariant: 'base',
    perturbedVariant: 'prop-button-secondary',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    spec: "spec §1 (the running example); §6.2 (changed props at a boundary)",
    rationale:
      'The spec\'s own headline sentence. Background, text colour and border resolve ' +
      'differently; the element, its role, its accessible name and its box are unchanged, ' +
      'so `token`. Rendered standalone the root is the Button itself, since nothing ' +
      'upstream provided the prop — compare `prop-primary-variant/hero`, which is the ' +
      'same visual change with a different root, and the pair is what tests that root ' +
      'assignment follows the provenance chain rather than the location of the pixels.',
    byProfile: {
      chromium: {
        expect: 'hash-changed',
        band: 'geometry',
        because:
          'The rationale claims the box is unchanged, and under a real engine that is false: ' +
          'the secondary variant carries a different border width, so the border box grows by ' +
          'a pixel on each side and `rect-changed` deltas exist. The correction is worth ' +
          'keeping visible — "only the colours changed" is exactly the assumption a token ' +
          'system invites and a layout engine refutes. Under `jsdom` there are no rects and ' +
          'the answer really is `token`.',
      },
    },
  },
  {
    id: 'prop-size/button',
    subject: 'button',
    baseVariant: 'base',
    perturbedVariant: 'prop-button-large',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    spec: 'spec §5; `band.ts` (`style-changed` ⇒ token, `rect-changed` ⇒ geometry); ADR-0008',
    byProfile: {
      chromium: {
        expect: 'hash-changed',
        band: 'geometry',
        roots: 1,
        because:
          'The verdict is the same under both profiles; the band is not. Under `chromium` the ' +
          'button measurably grows, so `rect-changed` deltas exist and `bandOf` puts them in ' +
          '`geometry`. `band.ts` argues the attributor should fold rect movement under the ' +
          'style change as collateral, which would report `token` — and nothing normative says ' +
          'a subject reports one band rather than a set, so both readings are available. ' +
          '`geometry` is declared because it is the louder of the two and every ambiguity in ' +
          'this project resolves toward over-reporting: a policy that blocks on `geometry` ' +
          'should stop for a button that changed size. Note that this expectation is weak ' +
          'evidence — it coincides with what `dominantBand` already does, so it confirms less ' +
          'than a case whose answer was fixed against an unwritten implementation.',
      },
    },
    rationale:
      'Padding and font-size resolve to larger values through a different set of spacing ' +
      'tokens. No node appears, disappears or changes role. The interesting property is ' +
      'that this is the smallest change in the corpus that lands in different bands under ' +
      'the two profiles, which makes it the natural probe for claim P4 — the profiles ' +
      'agreeing on what both can observe is only meaningful if there is a case where what ' +
      'they observe differs.',
  },
  {
    id: 'prop-primary-variant/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'hero-secondary-primary',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    spec: 'spec §6.2 (diff explained by changed props at a boundary ⇒ root is the provider)',
    rationale:
      "The pixels that move are Button's, but Button's source did not change and neither " +
      'did any token: Hero passed a different prop. The root is therefore Hero, and Button ' +
      'is where the change is *visible*, not where it originates. This is the case that ' +
      'distinguishes attribution from localization. A differ that blames the node whose ' +
      'style moved produces exactly the report the spec rejects — "Button changed" — and ' +
      'sends a reviewer to the wrong file.',
    byProfile: {
      chromium: {
        expect: 'hash-changed',
        band: 'geometry',
        because:
          'Same mechanism as `prop-variant/button`, one level up: the prop Hero passes ' +
          'selects a variant whose border width differs, so the Button box moves under a real ' +
          'engine. What this case is *for* — the root being Hero rather than Button — is ' +
          'unaffected by the band, and `roots: 1` still carries it.',
      },
    },
  },
  {
    id: 'tertiary-action/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'hero-tertiary-action',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    spec: 'spec §5 (`geometry`: boxes appear); `band.ts` `node-added`',
    rationale:
      'A third Button appears in the action row. A node with a role and an accessible name ' +
      'entered the accessibility tree, which is `geometry` by definition and independent ' +
      'of layout — so `jsdom` decides it as confidently as `chromium`, which is the ' +
      'concrete content of ADR-0002\'s claim that JSDOM covers "the structural half of ' +
      'geometry". Under `chromium` the sibling buttons also shift; those are collateral ' +
      'under the same root, not additional roots.',
  },
  {
    id: 'break-association/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'field-break-association',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    spec: 'ADR-0003 §1 (`#extern:<n>`, "a dangling reference is a real defect")',
    rationale:
      'The single most important case in the corpus, and it must be read against ' +
      '`id-shift/field`. In both, id *values* differ between the two renders; only here ' +
      'does a *relationship* break — `htmlFor` now names an element that does not exist, ' +
      'so the input has lost its accessible name. Nothing else differs: same nodes, same ' +
      'text, same computed styles, and under `chromium` the same rects, so no amount of ' +
      'layout or raster evidence would find it. Masking ids to a constant, which spec ' +
      '§4.2 originally prescribed, makes this render identical to the baseline and reports ' +
      'a real accessibility regression as `unchanged`. It is banded `a11y`: the input lost ' +
      'its accessible name and nothing moved, which is the band existing to carry exactly ' +
      'this. It was declared `geometry` until the bands were split, and the rationale had ' +
      'already been arguing for `a11y` in prose — "a real accessibility regression" — while ' +
      'the declared field said layout.',
  },
  {
    id: 'with-error/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'field-with-error',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    spec: 'spec §5; `ID_REFERENCE_LIST_ATTRIBUTES`; `aria.ts` `accessibleDescription`',
    rationale:
      'An error message node appears and `aria-describedby` grows from one reference to ' +
      'two. The node is `geometry`; the field gaining a description is `a11y`, and `a11y` ' +
      'is the louder of the two — "the email field is now described by its error" is the ' +
      'sentence a reviewer wants, and "a node appeared" is not. This case was declared ' +
      '`geometry` for as long as nothing captured the description: every `aria-*` attribute ' +
      'is dropped by `ATTRIBUTE_ALLOWLIST` on the stated grounds that they resolve into ' +
      'role/name/state, which was never true of `aria-describedby`. The reference-list ' +
      'growth is the other part worth isolating: the alias sequence shifts for every id ' +
      'after the insertion point, so a differ that compares alias strings positionally will ' +
      'report far more change than occurred. The hash must move — it should — but the ' +
      '*report* should name one added node and one new description, not a rewritten ' +
      'reference graph.',
  },
  {
    id: 'as-region/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'card-as-region',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    spec: 'spec §5; ADR-0002 §3; `match.ts` `matchKey`',
    rationale:
      'A `<div>` becomes a `<section aria-label>` with an implicit `region` role. Every ' +
      'computed style, every rect and every pixel is identical; a landmark appeared in the ' +
      'accessibility tree. A pixel differ cannot see this at any threshold, which is the ' +
      'general argument for the semantic stage sitting above raster rather than beside it. ' +
      'It also fixes the tag/role boundary: the snapshot keeps `tag`, so a normalizer that ' +
      'collapsed elements purely by box effect would still have to keep these apart. ' +
      'Banded `geometry` rather than `a11y`, and the reason is a limit worth stating: the ' +
      'element changed tag, so `matchKey` never pairs the two and the report is a removal ' +
      'plus an addition rather than a `role-changed`. The added node is described as ' +
      '`region "Details"`, so the landmark is named — but by `describe()`, not by the band. ' +
      'A tag change is a replacement to this differ, and pairing across one would need a ' +
      'similarity heuristic that nothing here has. Reaching this from one snapshot rather ' +
      'than from a pair is what `judge/a11y.ts` is for.',
  },
  {
    id: 'select-second/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'tabs-second',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    spec: 'spec §5 (state changes); `band.ts` `state-changed`',
    rationale:
      '`aria-selected` moves between tabs, `tabIndex` follows it, and a different panel is ' +
      'in the DOM. State is `a11y` because it changes what is *announced*, not what anything ' +
      'looks like — the visual difference (the accent underline) is downstream of the state, ' +
      'not the change itself. A panel also appears and disappears, which is `geometry`, so ' +
      'this is the case that fixes the ranking: the two bands are both present and the ' +
      'louder one wins. Decidable entirely without a layout engine, which is what makes it ' +
      'a `jsdom`-tier case.',
  },
  {
    id: 'strip-panel-role/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'tabs-strip-panel-role',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    spec: '`band.ts` (`role-changed` ⇒ a11y); ADR-0002 §3',
    rationale:
      'The panel keeps its element, its id, its text and every style, and loses ' +
      '`role="tabpanel"` and `aria-labelledby`. The tab still points at it via ' +
      '`aria-controls`, so the id graph is intact and aliasing produces the same shape — ' +
      'this is not the broken-reference case, it is the missing-role case, and a ' +
      'normalizer could plausibly get one right and the other wrong. Byte-identical ' +
      'rendering, materially different for a screen reader.',
  },
  {
    id: 'reorder/list',
    subject: 'list',
    baseVariant: 'base',
    perturbedVariant: 'list-rotated',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    spec: 'spec §5 (`node-moved`); `snapshot.ts` `NodePath`',
    rationale:
      'The same five items in a different order. The hash must move — the rendered content ' +
      'genuinely differs — so the interesting expectation is not the hash but the report: ' +
      'a differ keyed on `NodePath` alone sees five changed text nodes, while one that ' +
      'matches by shape and provenance first (as `NodePath`\'s own contract requires) sees ' +
      'a rotation. Both produce the same verdict and wildly different review costs, which ' +
      'is the half of M0 that hash stability does not measure.',
  },
  {
    id: 'prepend/list',
    subject: 'list',
    baseVariant: 'base',
    perturbedVariant: 'list-prepended',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    spec: '`snapshot.ts` `NodePath` ("a path change alone is evidence of nothing")',
    rationale:
      'One item added at the front — the worst case for positional addressing, since every ' +
      'subsequent path shifts by one. The honest report is one added node. Six reported ' +
      'changes is the failure mode, and it is the one that makes reviewers stop reading ' +
      'diffs, which is the same fatigue the computed-style allowlist exists to avoid.',
  },
  {
    id: 'relabel/list',
    subject: 'list',
    baseVariant: 'base',
    perturbedVariant: 'list-relabelled',
    expect: 'hash-changed',
    band: 'content',
    roots: 1,
    minCollateral: 0,
    spec: '`band.ts` (`text-changed` ⇒ content)',
    rationale:
      'Exactly one item relabelled, at a stable position. The control for the other two ' +
      'list cases: it is the one where "one change" is unambiguously correct, so it ' +
      'calibrates whether their larger reports are over-counting or whether the differ is ' +
      'simply verbose everywhere. It is also the only pure `content` case in the corpus — ' +
      'a string moved and nothing else did — which is what makes it the calibration for ' +
      'the band as well as for the count. The name is the accessible name of the list item ' +
      'too, so this is the one place `content` and `a11y` could be confused; the item is ' +
      'named from content, so the name is a consequence of the text rather than a second ' +
      'edit, and the differ must not report it twice.',
  },
  {
    id: 'dialog-open/dialog',
    subject: 'dialog',
    baseVariant: 'base',
    perturbedVariant: 'dialog-open',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    spec: 'ADR-0003 (subject subtree, `#extern:<n>`); ADR-0002 (false `unchanged`)',
    contested:
      'No ADR defines the subject subtree for portalled content, and the two readings ' +
      'disagree about the verdict. Under the DOM reading the panel is a child of ' +
      '`document.body`, nothing inside the container changed, and the correct answer is ' +
      '`hash-stable` — a modal dialog appearing is reported as `unchanged`, which ADR-0002 ' +
      'calls the worst possible failure mode. Under the fiber reading the panel belongs to ' +
      'the subject because its owner chain leads back into it, and the answer is ' +
      '`hash-changed`. Declared `hash-changed` because a rule that can report a dialog as ' +
      'unchanged is not one this product can ship, but that is an argument from ' +
      'consequences, not from anything written down. The decision belongs in an ADR, and ' +
      'this case should fail loudly until one exists. `renderCase` returns the portal host ' +
      'alongside the container precisely so a collector can implement either reading.',
    rationale:
      'A modal dialog appears, with a heading, a role, and a nested Card. Every criterion ' +
      'for `geometry` is met several times over. The perturbation is a `useState` flip of ' +
      'the kind every interactive story performs, so if portals are mishandled the failure ' +
      'is neither rare nor exotic.',
  },
  {
    id: 'wrapper-flex-block/wrappers',
    subject: 'wrappers',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-flex-block',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    spec: 'spec §4.2 ("no role, no visual effect on the box tree"); ADR-0008',
    byProfile: {
      jsdom: {
        undecidable:
          'Under `chromium` the inserted `<div>` becomes the flex item, the leaf stops being ' +
          'one, `column-gap` applies between different boxes and the leaves resize: a real ' +
          '`geometry` change, which is the declared answer. Under `jsdom` there is no layout ' +
          'engine and nothing distinguishes this from `wrapper-block/wrappers`. It would ' +
          'answer `hash-stable`, and that is not an expectation — it is a consequence of ' +
          'blindness. Scoring it as a pass credits the profile for an answer it reached by ' +
          'not looking, and inflates the one number that must not be inflated; scoring it as ' +
          'a miss charges the profile for a limitation its `ObservationProfile` already ' +
          'declares. Excluded (ADR-0008 §1).',
      },
    },
    rationale:
      'Spec §4.2 collapses wrappers with "no visual effect on the box tree", but whether a ' +
      '`<div>` has one is a property of its parent\'s formatting context, not of the ' +
      '`<div>`. This case and `wrapper-flex-contents/wrappers` are the same insertion into ' +
      'the same flex row, differing by one declaration that decides inertness — so a ' +
      'collapse rule that treats "generic `<div>`" as sufficient grounds gets one of the ' +
      'two wrong whichever way it answers.',
  },
];

/**
 * Cases whose ground truth is settled *for at least one profile*.
 *
 * Not the same as "scorable": a settled case can still be undecidable under a
 * given profile. Use {@link scorableFor} to get a profile's denominator, never
 * this list's length.
 */
export const SETTLED_CORPUS: readonly CorpusCase[] = CORPUS.filter((c) => c.contested === undefined);

/** Cases with disputed ground truth. Report them; do not score them silently. */
export const CONTESTED_CORPUS: readonly CorpusCase[] = CORPUS.filter((c) => c.contested !== undefined);

/**
 * What a given profile is expected to observe for a case (ADR-0008).
 *
 * Three outcomes, and the harness must handle all three differently. Folding
 * `undecidable` into either a pass or a miss is the specific dishonesty the
 * per-profile mechanism exists to prevent.
 */
export type Expectation =
  | {
      readonly kind: 'scorable';
      readonly expect: Verdict;
      readonly band?: ExpectedBand;
      readonly roots?: number;
      /** True when this profile's answer was declared separately from the default. */
      readonly perProfile: boolean;
      /** The per-profile argument, when there is one. */
      readonly because?: string;
    }
  | { readonly kind: 'undecidable'; readonly reason: string }
  | { readonly kind: 'contested'; readonly reason: string };

function isUndecidable(clause: ProfileClause): clause is Undecidable {
  return 'undecidable' in clause;
}

/**
 * Resolve a case against a profile.
 *
 * Order is fixed: `contested` outranks everything, because a case nobody has
 * decided cannot be scored under any profile — a per-profile clause on a
 * contested case would be answering a question that is still open. Then the
 * profile clause, then the default.
 */
export function expectationFor(corpusCase: CorpusCase, profile: ProfileId): Expectation {
  if (corpusCase.contested !== undefined) {
    return { kind: 'contested', reason: corpusCase.contested };
  }

  const clause = corpusCase.byProfile?.[profile];

  if (clause !== undefined && isUndecidable(clause)) {
    return { kind: 'undecidable', reason: clause.undecidable };
  }

  if (clause !== undefined) {
    return {
      kind: 'scorable',
      expect: clause.expect,
      ...(clause.band !== undefined ? { band: clause.band } : {}),
      ...(clause.roots !== undefined ? { roots: clause.roots } : {}),
      perProfile: true,
      because: clause.because,
    };
  }

  return {
    kind: 'scorable',
    expect: corpusCase.expect,
    ...(corpusCase.band !== undefined ? { band: corpusCase.band } : {}),
    ...(corpusCase.roots !== undefined ? { roots: corpusCase.roots } : {}),
    perProfile: false,
  };
}

/** A profile's denominator. Everything else is reported, never scored. */
export function scorableFor(profile: ProfileId): readonly CorpusCase[] {
  return CORPUS.filter((c) => expectationFor(c, profile).kind === 'scorable');
}

/** Cases a profile declares itself unable to decide. Reported with reasons. */
export function undecidableFor(profile: ProfileId): readonly CorpusCase[] {
  return CORPUS.filter((c) => expectationFor(c, profile).kind === 'undecidable');
}

/**
 * Cases on which two profiles may be compared to each other — claim P4's
 * denominator.
 *
 * Requires both to be scorable. A case one profile cannot see says nothing about
 * whether the two agree, and including it would let blindness look like consensus.
 */
export function comparableCases(a: ProfileId, b: ProfileId): readonly CorpusCase[] {
  return CORPUS.filter(
    (c) => expectationFor(c, a).kind === 'scorable' && expectationFor(c, b).kind === 'scorable',
  );
}

/**
 * True when the corpus declares that the two profiles reach *different verdicts*.
 *
 * A band-level divergence is not a verdict-level one: `prop-size/button` is
 * `hash-changed` under both profiles and differs only in band, so the two
 * verdicts must still match. Only a case listed here is allowed to disagree.
 */
export function declaresDivergence(corpusCase: CorpusCase, a: ProfileId, b: ProfileId): boolean {
  const left = expectationFor(corpusCase, a);
  const right = expectationFor(corpusCase, b);
  if (left.kind !== 'scorable' || right.kind !== 'scorable') return false;
  return left.expect !== right.expect;
}

export function casesFor(expect: CorpusCase['expect']): readonly CorpusCase[] {
  return CORPUS.filter((c) => c.expect === expect);
}

export interface CorpusSummary {
  readonly total: number;
  readonly stable: number;
  readonly changed: number;
  readonly geometry: number;
  readonly token: number;
  readonly contested: readonly string[];
}

/**
 * Shape of the corpus, for a harness to print beside its results.
 *
 * A pass rate is uninterpretable without it. "97% of cases passed" means nothing
 * if the reader cannot see that the failures were concentrated in the twenty cases
 * where the hash was supposed to *move* — which is the failure that matters, since
 * a normalizer that erases too much passes every stability case there is.
 */
export function corpusSummary(): CorpusSummary {
  return {
    total: CORPUS.length,
    stable: casesFor('hash-stable').length,
    changed: casesFor('hash-changed').length,
    geometry: CORPUS.filter((c) => c.band === 'geometry').length,
    token: CORPUS.filter((c) => c.band === 'token').length,
    contested: CONTESTED_CORPUS.map((c) => c.id),
  };
}
