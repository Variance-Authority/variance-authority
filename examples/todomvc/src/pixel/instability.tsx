import type { ReactNode } from 'react';

/**
 * Declared here rather than imported from `probes.ts` so that `probes.ts` can
 * import this file for the shared lookup without a cycle.
 */
export type ProbeState = 'before' | 'after';

/**
 * Instability probes: what makes visual regression flaky in a real pipeline.
 *
 * The previous flakiness measurement asked whether shooting the same mounted
 * story twice produces the same bytes. It does, exactly, every time — and that
 * result was reported as "the camera is not flaky", which is a conclusion about
 * a sensor drawn from an experiment with every source of real variance removed.
 *
 * Nobody's screenshots differ because the camera drifted. They differ because
 * **the same commit rendered twice does not render identically**: a font
 * substitutes, a runner has a different pixel ratio, a scrollbar appears under
 * load, a timestamp advances, an image decodes a frame later. That is real work
 * showing up in the picture, and it is the thing a VR tool actually has to
 * survive.
 *
 * So each probe here is a *pair of runs of the same code*, differing only in
 * something a pipeline does not control. Both arms are measured against each,
 * and the expectation is declared before the measurement — including the cases
 * where the semantic arm is the one that flakes.
 *
 * What this set is designed to show is not "we win". It is which instabilities
 * each arm can be *made* to absorb, and at what cost:
 *
 * - absorbed by construction (the change cannot reach the representation),
 * - absorbed by the environment key (the two runs are different baselines, not a
 *   diff),
 * - absorbed only by policy (masking, settle points) — which both arms need, and
 *   which is where "just raise the threshold" quietly becomes "stop looking",
 * - or not absorbed at all.
 */

export type Arm = 'moves' | 'holds';

/**
 * A note on what these probes are.
 *
 * Actually varying the machine, the installed fonts, or the GPU is not available
 * inside a test, so each probe *simulates* the difference by the smallest change
 * that produces the same observable — a smoothing mode instead of a different
 * driver, a second browser context instead of a second runner. That is a
 * simulation and is called one; what it is not is a code edit dressed up as
 * variance, which is a mistake this file made on its first attempt. The scrollbar
 * probe originally changed the subject's own height, which is simply an edit, and
 * it was rewritten to change the page around the subject instead.
 */

export interface InstabilityProbe {
  readonly id: string;
  /** What, in a real pipeline, produces this between two runs of one commit. */
  readonly cause: string;
  /**
   * Declared before measuring. A probe that only records outcomes proves nothing.
   *
   * `content` is the structure and style hashes, *not* the render hash. The
   * render hash folds in the environment key, so anything that legitimately
   * changes the environment necessarily moves it — which would make "did the
   * representation of the page change?" unanswerable for exactly the probes that
   * ask it. The first version of this file predicted `renderHash` would hold for
   * a device-pixel-ratio change while also claiming the environment key would
   * differ, which cannot both be true.
   */
  readonly expect: { readonly pixels: Arm; readonly content: Arm };
  /** Whether the two runs should land in different baseline slots entirely. */
  readonly expectEnvKeyDiffers?: boolean;
  /** Why that is the *correct* answer, not merely the observed one. */
  readonly rationale: string;
  /** How the instability is survivable, if it is. */
  readonly absorbedBy:
    | 'construction'
    | 'environment-key'
    | 'policy'
    | 'nothing'
    /** Does not reproduce headless, which is itself the finding. */
    | 'headless-artifact';

  readonly css?: (state: ProbeState) => string | undefined;
  readonly render: (state: ProbeState) => ReactNode;
  /** Runs the `after` state under a second harness at `deviceScaleFactor: 2`. */
  readonly secondHarnessDpr?: boolean;
}

export const INSTABILITY_PROBES: readonly InstabilityProbe[] = [
  {
    id: 'text-smoothing',
    cause: 'the same commit rendered on a different OS, GPU, or driver',
    /**
     * **macOS only, and that is a finding rather than a caveat.**
     *
     * The declaration below is what a macOS Chromium does and it stands there.
     * The first Linux run of this corpus (2026-08-03) measured 0 changed pixels,
     * because the perturbation is `-webkit-font-smoothing` — a property no
     * engine outside macOS implements. So on the platform this probe's own
     * `cause` field is *about*, the perturbation is inert.
     *
     * What that refutes is narrow and worth stating exactly. It does not refute
     * the `texture` band: rasterization really does vary across machines, and
     * the semantic arm really cannot see it. It refutes **this repository's only
     * evidence for it**, which turns out to be a simulation that works on the
     * machine that wrote it — the same convenience journal 0008 caught in the
     * token fixtures, arriving in the pixel corpus.
     *
     * Real evidence needs two machines rendering one page, which is what
     * `docker/linux-verify.sh` exists for and what a CSS toggle was standing in
     * for. Left declared as-is and skipped nowhere: a probe that quietly
     * lowered its expectation on Linux would be the corpus adjusting to the run.
     */
    expect: { pixels: 'moves', content: 'holds' },
    absorbedBy: 'construction',
    rationale:
      'Identical text, identical metrics, different rasterization. This is the ' +
      '`texture` band of §5 exactly: sub-semantic rendering variance that no ' +
      'reviewer should ever be shown. The semantic arm cannot see it because ' +
      'glyph rasterization is not a property of the box tree — absorbed by ' +
      'construction rather than by a threshold. ' +
      'DECLARED ON macOS AND REFUTED AS A DEMONSTRATION ON LINUX, 2026-08-03: ' +
      'the perturbation is `-webkit-font-smoothing`, which only macOS ' +
      'implements, so on a Linux Chromium both renders are byte-identical and ' +
      'this probe measures 0 changed pixels. The band is not wrong; its only ' +
      'evidence here simulates "a different OS" with a property one OS honours.',
    css: (state) =>
      `.probe-copy { -webkit-font-smoothing: ${state === 'before' ? 'subpixel-antialiased' : 'antialiased'}; }`,
    render: () => (
      <p className="va-text probe-copy">
        Rasterization differs between machines even when metrics do not.
      </p>
    ),
  },
  {
    id: 'device-pixel-ratio',
    cause: 'one CI runner is retina, the next is not',
    expect: { pixels: 'moves', content: 'holds' },
    expectEnvKeyDiffers: true,
    absorbedBy: 'environment-key',
    rationale:
      'Every pixel differs, and nothing about the page did. The semantic arm ' +
      'holds because layout rects are CSS pixels — but "holds" would be the ' +
      'wrong answer on its own, since a 2x render genuinely is a different ' +
      'artifact. It is right because `deviceScaleFactor` is in the environment ' +
      'key, so the two runs address different baselines and never meet. A pixel ' +
      'differ has the same option and must be configured to take it.',
    render: () => (
      <p className="va-text probe-copy">Same markup, twice the device pixels.</p>
    ),
    secondHarnessDpr: true,
  },
  {
    id: 'scrollbar',
    cause: 'content crosses the viewport height, so a scrollbar takes 15px of width',
    // Measured: neither arm moves, because the flake does not exist here.
    expect: { pixels: 'holds', content: 'holds' },
    absorbedBy: 'headless-artifact',
    rationale:
      'This was written expecting both arms to move: a scrollbar takes 15px of ' +
      'width and reflows everything, and the trigger is outside the subject, so ' +
      'nothing in the component changed. Headless Chromium disagrees — it uses ' +
      'overlay scrollbars, so growing the page to 2400px leaves the subject at ' +
      'exactly 1008px and not a pixel moves.\n\n' +
      'That is a better finding than the one intended, and it belongs to *both* ' +
      'arms equally. A headless pipeline cannot see a scrollbar-induced reflow ' +
      'that every headed user experiences — so the classic "it only flakes in ' +
      'CI" story is, for this cause, exactly inverted: CI is the environment ' +
      'that cannot see it. Neither arm absorbs it; both are blind to it.',
    css: (state) =>
      state === 'after' ? 'body { min-height: 2400px; }' : undefined,
    render: () => (
      <p className="va-text">A component that never asked about the page height.</p>
    ),
  },
  {
    id: 'clock',
    cause: 'the UI renders a timestamp, and the second run happens later',
    expect: { pixels: 'moves', content: 'moves' },
    absorbedBy: 'policy',
    rationale:
      'Both arms move, and neither is wrong: the rendered content really is ' +
      'different. The difference is what absorbing it costs. A pixel differ needs ' +
      'a coordinate region masked, which silences whatever else lands there and ' +
      'breaks when the layout moves. The semantic arm masks the *text node*, ' +
      'which follows the content — `normalize({ digestText: true })` — and keeps ' +
      'watching everything around it.',
    render: (state) => (
      <p className="va-text">
        {`Last synced 2026-08-01T09:${state === 'before' ? '14' : '15'}:00Z`}
      </p>
    ),
  },
  {
    id: 'block-whitespace',
    cause: 'a formatter reindents JSX inside a block element',
    expect: { pixels: 'holds', content: 'moves' },
    absorbedBy: 'nothing',
    rationale:
      'The case where *we* flake and the camera does not. Leading and trailing ' +
      'whitespace inside a block collapses away, so nothing renders differently ' +
      '— but telling a block context from an inline one needs a layout engine, ' +
      'and the normalizer does not consult one even under `chromium`. Journal ' +
      '0005 recorded the over-report when the rule was written; this measures it. ' +
      'A pixel differ is simply right here.',
    render: (state) =>
      state === 'before' ? (
        <p className="va-text">
          <span>a</span> <span>b</span>
        </p>
      ) : (
        <p className="va-text">
          {' '}
          <span>a</span> <span>b</span>{' '}
        </p>
      ),
  },
];
