/**
 * Real changes in which a **style input** moved and the tree did not.
 *
 * An injected rule that wins the cascade, a media condition that holds, a token
 * whose value changed, a prop that selects a different variant: in all nine the
 * same elements sit in the same places with the same roles, names and text, and
 * only a resolved value differs. That makes them the sharp half of the
 * false-negative guard — a normalizer that erased style outright passes every
 * case in `corpus-stable.ts` and fails all of these, which is the only reason
 * the stable list means anything.
 *
 * Kept apart from `corpus-restructured.ts` because the two halves interrogate
 * different stages. These ask whether the collector *resolved* the cascade
 * rather than recording it; those ask whether the differ matched and attributed.
 * Four of the nine also carry a `chromium` clause moving the band to `geometry`,
 * which is one observation stated once per case: "only the colours changed" is
 * what a token system invites a reader to believe and what a layout engine
 * refutes.
 *
 * Spliced into `CORPUS` in `corpus.ts`.
 */

import type { CorpusCase } from './corpus-case.js';

/**
 * Named first and exported at the bottom, for a checker rather than for taste.
 *
 * `tools/boundaries.check.ts` finds a package's imports through `specifiersIn`
 * in `tools/workspaces.ts`, a line-anchored regex that runs from an `export`
 * keyword to the first `from '…'` it meets without crossing a `;`. Comments are
 * stripped before it runs, so only a string literal can trip it —
 * `css-matched-media/card` argues, in its `rationale`, about what a rule that
 * discarded everything `from "inside an at-rule"` would score — so
 * opening the literal with `export const` puts that sentence inside an apparent
 * import statement, and the package is reported as depending on a phrase. It
 * survived in the undivided `corpus.ts` only by accident: a semicolon in an
 * unrelated `spec` field three hundred lines earlier happened to stop the scan.
 *
 * The alternative was editing a rationale to suit a regex, and a rationale is
 * the thing in this file with something to say.
 */
const RESTYLED: readonly CorpusCase[] = [
  {
    id: 'css-winning-rules/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-winning-rules',
    expect: 'hash-changed',
    band: 'token',
    roots: 1,
    blames: 'Card',
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
    blames: 'Card',
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
    blames: '--va-radius-md',
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
    blames: '--ks-card-radius',
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
    blames: '--va-color-accent',
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
    blames: '--va-space-3',
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
    blames: 'Button',
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
    blames: 'Button',
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
    blames: 'Button',
    spec: 'spec §6.2 (diff explained by changed props at a boundary ⇒ root is the provider)',
    rationale:
      "The pixels that move are Button's, but Button's source did not change and neither " +
      'did any token: Hero passed a different prop. The **root** is therefore Hero — the ' +
      'docket entry reads `prop: Hero` — and Button is where the change is *visible*. This ' +
      'is the case that distinguishes attribution from localization.\n\n' +
      '`blames` is nevertheless `Button`, and the correction is worth keeping rather than ' +
      'arguing away. This case was written to test attribution to a **provider inside the ' +
      'subject**, and it does not construct that shape: Hero does not decide the variant, ' +
      'it forwards `p.props.heroPrimaryVariant` from the fixture. So the props arrive from ' +
      'outside the subject, no component inside it is responsible, and Hero\'s source is ' +
      'exactly as unchanged as Button\'s — sending a reviewer there is the same failure one ' +
      'level out. The differ names the innermost owner, where the change landed, and the ' +
      'entry label still says whose props moved. **No case in this corpus constructs a ' +
      'provider-backed prop root**; the only thing asserting that path is ' +
      '`packages/dom/src/attributed.test.ts`, which is a gap in the corpus rather than in ' +
      'the differ.',
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
];

export const RESTYLED_CASES = RESTYLED;
