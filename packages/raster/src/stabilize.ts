import { digestValue, type Digest } from '@variance-authority/core';

/**
 * What is done *to* the subject so it can be observed, stated rather than done.
 *
 * A subject that is still moving cannot be compared, so every visual-regression
 * system reaches into the page: it pauses animations, waits for fonts, hides the
 * caret, suppresses scrollbars. That work is necessary and it is not free — each
 * intervention widens the gap between what was measured and what a person will
 * actually see. An image of a page with its animations frozen is not an image of
 * the product.
 *
 * The failure this file exists to prevent is subtler than the gap itself. If two
 * runs stabilise differently, the images differ for a reason that has nothing to
 * do with the code, and the report blames whichever component happens to sit
 * under the pixels. That is the same defect as comparing across machines
 * (ADR-0011), arriving through a different door — so it takes the same cure: the
 * applied set is part of the renderer's identity, and a baseline stabilised one
 * way is `incomparable` with a run stabilised another, never `changed`.
 *
 * **Interventions are applied from outside the subject wherever possible.**
 * Injected CSS costs the product nothing: no component imports it, no component
 * is shaped by it, and deleting the tool deletes the intervention. Asking the
 * subject to change — to attach a marker, to expose a hook — is design damage,
 * small but real, and is reserved for what the outside genuinely cannot know.
 * Whether a component has finished its own asynchronous work is the honest
 * example: nothing outside it can tell, so that one is worth the cost and is
 * opt-in rather than assumed.
 *
 * Patching the runtime instead — wrapping `Promise`, replacing `Suspense` — buys
 * the same knowledge without touching a component, and is deliberately not done
 * here. It moves the damage from the design into the semantics: the subject then
 * runs on primitives the product does not use, and a difference caused by the
 * patch is indistinguishable from a difference caused by the code.
 */

export interface Stabilization {
  /** Hold CSS animations and transitions at their first frame. */
  readonly animations: boolean;
  /** Hide the text caret, which blinks on its own schedule. */
  readonly caret: boolean;
  /** Hide scrollbars, whose width is a platform and preference difference. */
  readonly scrollbars: boolean;
  /** Wait for web fonts before observing. Changes metrics, so it changes layout. */
  readonly fonts: boolean;
  /** Wait for images to decode. Their intrinsic size participates in layout. */
  readonly images: boolean;
}

/**
 * Nothing at all — correct for a tier that observes structure and declared style.
 *
 * The saving here is real and is the reason this is a set rather than a switch.
 * A font that has not loaded cannot change which rules match or what they
 * declare, and an image that has not decoded cannot either. Waiting for both
 * before taking a structure-and-style hash buys nothing and costs the wait on
 * every subject, on the tier that is supposed to be the cheap one.
 */
export const NO_STABILIZATION: Stabilization = {
  animations: false,
  caret: false,
  scrollbars: false,
  fonts: false,
  images: false,
};

/**
 * What a tier that resolves layout needs, and no more.
 *
 * Fonts and images enter because they change metrics and intrinsic sizes;
 * animations enter because a transform is a resolved value and a moving one is
 * observed at whatever moment the capture arrived; scrollbars enter because a
 * scrollbar that takes width reflows everything beside it. The caret is left
 * out: it paints and does not lay out, so a tier that never rasterizes cannot
 * see it.
 */
export const LAYOUT_STABILIZATION: Stabilization = {
  animations: true,
  caret: false,
  scrollbars: true,
  fonts: true,
  images: true,
};

/** Everything layout needs, plus what only a camera can see. */
export const RASTER_STABILIZATION: Stabilization = {
  ...LAYOUT_STABILIZATION,
  caret: true,
};

/**
 * The CSS that holds the page still.
 *
 * Injected, never required of the subject. Animations are pinned to their first
 * frame rather than disabled outright — `animation: none` removes any layout the
 * animation's own keyframes contribute, which changes the page rather than
 * stopping it. Negative delay plus paused state holds the clock at zero while
 * leaving every declaration in force.
 */
export function stabilizationCss(stabilization: Stabilization): string {
  const rules: string[] = [];

  if (stabilization.animations) {
    rules.push(
      '*,*::before,*::after{' +
        'animation-play-state:paused !important;' +
        'animation-delay:-0.0001s !important;' +
        'transition-duration:0s !important;' +
        'transition-delay:0s !important;' +
        'scroll-behavior:auto !important}',
    );
  }

  if (stabilization.caret) rules.push('*{caret-color:transparent !important}');

  if (stabilization.scrollbars) {
    rules.push('*{scrollbar-width:none !important}', '*::-webkit-scrollbar{display:none !important}');
  }

  return rules.join('\n');
}

/**
 * The identity of an applied set.
 *
 * Folded into `RenderIdentity`, which is what makes a cross-stabilisation
 * comparison report `incomparable` rather than inventing a component to blame.
 * Keyed on every field including the `false` ones, because "we did not pause
 * animations" is as much a property of the image as "we did".
 */
export function stabilizationDigest(stabilization: Stabilization): Digest {
  return digestValue({
    animations: stabilization.animations,
    caret: stabilization.caret,
    scrollbars: stabilization.scrollbars,
    fonts: stabilization.fonts,
    images: stabilization.images,
  });
}

/** The applied set as a phrase a report can carry, so the gap stays visible. */
export function describeStabilization(stabilization: Stabilization): string {
  const applied = [
    stabilization.animations ? 'animations paused' : null,
    stabilization.caret ? 'caret hidden' : null,
    stabilization.scrollbars ? 'scrollbars hidden' : null,
    stabilization.fonts ? 'waited for fonts' : null,
    stabilization.images ? 'waited for images' : null,
  ].filter((entry): entry is string => entry !== null);

  return applied.length === 0
    ? 'the subject was observed untouched'
    : `the subject was altered to be observable: ${applied.join(', ')}`;
}
