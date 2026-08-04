import { digestValue, type Digest } from '@variance-authority/core';

/**
 * Interventions as separate, nameable tricks — not a fixed set of switches.
 *
 * A subject that is still changing cannot be compared, so every system of this
 * kind reaches into the page: it holds animations, waits for fonts, hides a
 * caret, suppresses scrollbars. Written as one struct of booleans that becomes a
 * closed vocabulary: adding a trick edits a type every caller depends on, and a
 * project with a need nobody anticipated has to fork.
 *
 * So each is a value. It carries an id, the tier that can actually observe what
 * it fixes, what it costs, and how it is applied — and a *recipe* is any list of
 * them. Two tricks may express the same intent through different mechanisms and
 * remain separate values, because they produce different images and choosing
 * between them is the caller's business.
 *
 * ## What this buys
 *
 * A recipe can be filtered by tier, so the structure-and-style rung waits for
 * nothing; composed from another project's tricks alongside these; digested, so
 * a baseline made under one recipe is `incomparable` with a run made under
 * another rather than `changed`; and checked for tricks that fight each other.
 *
 * ## Where the damage lands
 *
 * Ordered by increasing cost, earliest sufficient option first:
 *
 * - **Outside the subject** — injected CSS, browser screenshot options. Nothing
 *   in the product imports it and deleting the tool deletes the intervention.
 * - **Runtime substitution** — wrapping `Promise`, replacing a suspense
 *   boundary. Buys the same knowledge without touching a component and is
 *   deliberately not shipped here: it moves the damage from design into
 *   semantics, where a difference caused by the patch cannot be told apart from
 *   a difference caused by the code. Expressible as a trick if a project decides
 *   the trade is worth it — that is the point of an open set.
 * - **A contract the subject implements** — a readiness marker. Real design
 *   damage, and reserved for what the outside genuinely cannot know.
 */

/** The cheapest tier that can observe what a trick fixes. */
export type Tier = 'semantic' | 'layout' | 'raster';

/** What kind of move it is, for reading a recipe at a glance. */
export type Trick =
  /** Puts the page into a known state. */
  | 'reset'
  /** Stops something that would otherwise keep moving. */
  | 'hold'
  /** Blocks until something outside the page's control has landed. */
  | 'wait'
  /** Removes something that is present but must not be measured. */
  | 'support';

/** Screenshot options a trick contributes. Narrow on purpose. */
export interface ScreenshotOptions {
  readonly animations?: 'disabled';
  readonly caret?: 'hide';
}

/** The page surface a `settle` step may use. Structural, so no driver leaks in. */
export interface SettleTarget {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
}

export interface Intervention {
  /**
   * Stable identifier, and part of the recipe's digest.
   *
   * Renaming one is therefore a new identity, which is correct: a reader
   * comparing two runs has no way to know that `hold-animations` and
   * `pause-animations` were the same trick.
   */
  readonly id: string;
  readonly trick: Trick;
  readonly needs: Tier;
  /** What it does and what it costs, in one sentence a report can print. */
  readonly because: string;

  /**
   * The property this trick governs.
   *
   * Two tricks claiming one subject are in conflict — pinning animations in CSS
   * while asking the compositor to fast-forward them applies both, and the CSS
   * wins silently. See {@link conflicts}.
   */
  readonly governs: string;

  readonly css?: string;
  readonly screenshot?: ScreenshotOptions;
  readonly settle?: (target: SettleTarget) => Promise<void>;
}

/**
 * Hand animations to the browser rather than emulating the hold in CSS.
 *
 * A browser disabling animations for a screenshot fast-forwards a finite
 * animation to completion — the state a user comes to rest on — and cancels an
 * infinite one to its initial frame, replaying it afterwards. That is the
 * behaviour worth having, and CSS cannot express it.
 */
export const holdAnimations: Intervention = {
  id: 'hold-animations',
  trick: 'hold',
  needs: 'layout',
  governs: 'animations',
  because: 'animations settled by the browser: finite fast-forwarded, infinite reset',
  screenshot: { animations: 'disabled' },
};

/**
 * The same intent without a browser that can do it, and it is not equivalent.
 *
 * Pins every animation at its first frame, so a fade-in is captured at the
 * moment it is invisible. `animation: none` is avoided deliberately — removing
 * an animation drops whatever layout its keyframes contribute, which changes the
 * page rather than stopping it.
 */
export const pinAnimations: Intervention = {
  id: 'pin-animations',
  trick: 'hold',
  needs: 'layout',
  governs: 'animations',
  because: 'animations pinned at their first frame, which is not where a user sees them',
  css:
    '*,*::before,*::after{' +
    'animation-play-state:paused !important;' +
    'animation-delay:-0.0001s !important;' +
    'transition-duration:0s !important;' +
    'transition-delay:0s !important;' +
    'scroll-behavior:auto !important}',
};

export const hideCaret: Intervention = {
  id: 'hide-caret',
  trick: 'support',
  // A caret paints and does not lay out, so a tier that never rasterizes cannot
  // see it and must not pay to hide it.
  needs: 'raster',
  governs: 'caret',
  because: 'text caret hidden, because it blinks on its own schedule',
  screenshot: { caret: 'hide' },
};

export const hideScrollbars: Intervention = {
  id: 'hide-scrollbars',
  trick: 'support',
  needs: 'layout',
  governs: 'scrollbars',
  because: 'scrollbars hidden, removing a platform and preference difference — and their width',
  css: '*{scrollbar-width:none !important}\n*::-webkit-scrollbar{display:none !important}',
};

export const waitForFonts: Intervention = {
  id: 'wait-for-fonts',
  trick: 'wait',
  needs: 'layout',
  governs: 'fonts',
  because: 'waited for web fonts, whose advances change every metric on the page',
  settle: async (target) => {
    await target.evaluate(() => window.document.fonts.ready.then(() => undefined));
  },
};

export const waitForImages: Intervention = {
  id: 'wait-for-images',
  trick: 'wait',
  needs: 'layout',
  governs: 'images',
  because: 'waited for images to decode, since their intrinsic size participates in layout',
  settle: async (target) => {
    await target.evaluate(() =>
      Promise.all(
        Array.from(window.document.images)
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
              }),
          ),
      ).then(() => undefined),
    );
  },
};

export const INTERVENTIONS: readonly Intervention[] = [
  holdAnimations,
  pinAnimations,
  hideCaret,
  hideScrollbars,
  waitForFonts,
  waitForImages,
];

export type Recipe = readonly Intervention[];

/**
 * Nothing at all, and correct for the tier that reads structure and declared style.
 *
 * A font that has not loaded cannot change which rules match or what they
 * declare; an image that has not decoded cannot either. Waiting for both before
 * a structure-and-style hash buys nothing and costs the wait per subject, on the
 * rung the tier ladder exists to make cheap.
 */
export const SEMANTIC_RECIPE: Recipe = [];

export const LAYOUT_RECIPE: Recipe = [holdAnimations, hideScrollbars, waitForFonts, waitForImages];

export const RASTER_RECIPE: Recipe = [...LAYOUT_RECIPE, hideCaret];

/** Only the tricks a tier can observe the effect of. */
export function forTier(recipe: Recipe, tier: Tier): Recipe {
  const rank: Record<Tier, number> = { semantic: 0, layout: 1, raster: 2 };
  return recipe.filter((intervention) => rank[intervention.needs] <= rank[tier]);
}

/**
 * Tricks in a recipe that claim the same property.
 *
 * Returned rather than thrown, so a caller can decide — an override is a
 * legitimate composition, and silently applying both is not. Two tricks over one
 * property means one of them wins by accident of ordering, and which one is
 * invisible in the result.
 */
export function conflicts(recipe: Recipe): readonly { governs: string; ids: readonly string[] }[] {
  const byProperty = new Map<string, string[]>();

  for (const intervention of recipe) {
    byProperty.set(intervention.governs, [
      ...(byProperty.get(intervention.governs) ?? []),
      intervention.id,
    ]);
  }

  return [...byProperty.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([governs, ids]) => ({ governs, ids }));
}

export function recipeCss(recipe: Recipe): string {
  return recipe
    .map((intervention) => intervention.css)
    .filter((css): css is string => css !== undefined)
    .join('\n');
}

export function recipeScreenshot(recipe: Recipe): ScreenshotOptions {
  return recipe.reduce<ScreenshotOptions>(
    (options, intervention) => ({ ...options, ...intervention.screenshot }),
    {},
  );
}

export async function settleRecipe(recipe: Recipe, target: SettleTarget): Promise<void> {
  for (const intervention of recipe) {
    if (intervention.settle !== undefined) await intervention.settle(target);
  }
}

/**
 * The identity of a recipe.
 *
 * Sorted, so the order tricks were composed in does not change the identity —
 * only which ones are present. Folded into `RenderIdentity`, which is what makes
 * a cross-recipe comparison report `incomparable` instead of inventing a
 * component to blame.
 */
export function recipeDigest(recipe: Recipe): Digest {
  return digestValue(recipe.map((intervention) => intervention.id).sort());
}

/** The recipe as a sentence, so the gap between image and product stays visible. */
export function describeRecipe(recipe: Recipe): string {
  return recipe.length === 0
    ? 'the subject was observed untouched'
    : `the subject was altered to be observable: ${recipe.map((i) => i.because).join('; ')}`;
}
