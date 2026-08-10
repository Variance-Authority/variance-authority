import { digestValue, type Digest } from './hash.js';
import { tierReaches, type Tier } from './tier.js';

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
 *
 * ## Why this is in `format` and not in the raster package
 *
 * It was in `@variance-authority/raster` until 2026-08-06, on the reading that
 * holding a page still is something you do before you photograph it. That
 * reading was wrong in a way that cost correctness: an animation in flight is a
 * *computed style value*, so it reaches the cheap representation too — and the
 * allowlist excludes `animation-*` and `transition-*` precisely because it
 * assumed a snapshot is taken with animation already disabled. Nothing disabled
 * it. See {@link COLLECT_RECIPE} and ADR-0028.
 *
 * So a recipe is a render input on every tier, `EnvironmentInputs` carries its
 * digest, and the vocabulary belongs beside the key it is part of.
 */


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

/**
 * The page's globals, as the little of them a settle step needs.
 *
 * A settle closure is the one place in `core` that reads a live document, and it
 * gets away with it because it never runs here: it is handed to
 * {@link SettleTarget.evaluate}, which ships it into a page. ADR-0001's
 * enforcement is `core`'s `tsconfig`, which has no `lib.dom` — so writing
 * `window.document.fonts` is a compile error and this shape is what remains.
 *
 * That is a stricter arrangement than the convention it replaced, not a
 * loophole. Everything a settle step may touch is enumerated here, in one
 * declaration a reader can check, and a trick that wants more of the DOM has to
 * widen it in public rather than reach for an ambient global.
 */
interface PageGlobals {
  readonly document: {
    readonly fonts?: { readonly ready: Promise<unknown> };
    readonly images: ArrayLike<{
      readonly complete: boolean;
      addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
    }>;
  };
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

/**
 * Drop the pixels of images the page itself called decorative, keeping their boxes.
 *
 * The other half of blanking, and it lives here because of what it needs to
 * know. A driver rewriting responses (`@variance-authority/playwright`'s
 * `blank` rules) can decide by URL and by intrinsic size, which answers "every
 * illustration over 40,000 pixels" and answers it before the bytes are even
 * fetched. It cannot answer `role="presentation"`, because a request carries no
 * idea which element wanted it — that fact exists only in the document, so the
 * trick that uses it is a stylesheet.
 *
 * `visibility:hidden` rather than `display:none`, and the distinction is the
 * entire design: a hidden element still occupies exactly the box it would have,
 * so a page whose column height comes from an image's intrinsic size is
 * unchanged. `display:none` would collapse it and report a layout regression
 * this tool caused.
 *
 * **Opt-in, and it belongs in no default recipe.** Every other trick here
 * removes something that is not part of the assertion — a caret, a scrollbar, an
 * animation mid-flight. This one removes page content, which is a judgement
 * about what a suite is for, and a default that quietly stopped watching every
 * `alt=""` image would hide real regressions under a green run.
 */
export const hidePresentationalImages: Intervention = {
  id: 'hide-presentational-images',
  trick: 'support',
  // `layout` rather than `raster`, and the difference is whether it runs at all.
  // A raster-tier trick is filtered out of every *collection* — `tierOfProfile`
  // never returns `raster` — so it would only reach a page through a renderer
  // option, which is not where an operator configures their suite. A collection
  // sheet is in force when the document is serialized, so hiding it here is what
  // makes the pixels absent from the render.
  needs: 'layout',
  governs: 'presentational-images',
  because:
    'images the page marked decorative hidden, keeping their boxes — real changes inside them ' +
    'are not reported',
  css:
    'img[role="presentation"],img[alt=""],[role="presentation"] img,[role="none"] img' +
    '{visibility:hidden !important}',
};

export const waitForFonts: Intervention = {
  id: 'wait-for-fonts',
  trick: 'wait',
  needs: 'layout',
  governs: 'fonts',
  because: 'waited for web fonts, whose advances change every metric on the page',
  // Written without a module-scope helper on purpose: a settle closure is
  // shipped to a page as source text, so anything it names by identifier is a
  // `ReferenceError` on the far side. Types are erased and therefore free.
  settle: async (target) => {
    await target.evaluate(async () => {
      const view = globalThis as unknown as PageGlobals;
      await view.document.fonts?.ready;
    });
  },
};

export const waitForImages: Intervention = {
  id: 'wait-for-images',
  trick: 'wait',
  needs: 'layout',
  governs: 'images',
  because: 'waited for images to decode, since their intrinsic size participates in layout',
  settle: async (target) => {
    await target.evaluate(async () => {
      const view = globalThis as unknown as PageGlobals;
      await Promise.all(
        Array.from(view.document.images)
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
              }),
          ),
      );
    });
  },
};

export const INTERVENTIONS: readonly Intervention[] = [
  holdAnimations,
  pinAnimations,
  hideCaret,
  hideScrollbars,
  hidePresentationalImages,
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

/**
 * What is applied to a live page *before a subject is observed*, as opposed to
 * before it is painted.
 *
 * The two are different recipes and it is not a preference. {@link
 * holdAnimations} is a *screenshot option* — it asks the browser to settle
 * animations for the image it is about to take — and there is no screenshot at
 * collection time, so it would be a trick that silently does nothing. The CSS
 * variant is the one that works where nobody is holding a camera, which is the
 * whole reason both exist as separate values rather than as one switch.
 *
 * ## Why the cheap tier needs this at all
 *
 * The claim in [`ruleset.ts`](../rules/ruleset.ts) that `transition-*` and
 * `animation-*` "describe a journey the snapshot does not contain" is only true
 * if the snapshot is taken with the journey stopped. `transform`, `opacity`,
 * `filter`, `color` and every geometric longhand *are* admitted, and an
 * animation in flight moves all of them — so an unstabilized collection turns a
 * 300ms fade into a component-attributed regression with a real file name on it,
 * which is worse than an unexplained pixel diff because it is credible.
 *
 * Filtered by {@link forTier}, so jsdom applies none of it: with no layout
 * engine and no animation clock there is nothing to hold still, and paying a
 * `fonts.ready` wait per subject on the rung that exists to be cheap is exactly
 * the trade {@link SEMANTIC_RECIPE} refuses.
 */
export const COLLECT_RECIPE: Recipe = [
  pinAnimations,
  hideScrollbars,
  waitForFonts,
  waitForImages,
];

/**
 * Resolve a trick by the name a caller wrote down.
 *
 * The boundary a collection recipe crosses is a `page.evaluate`, and an
 * `Intervention` does not survive it — `settle` is a function. Ids do survive,
 * and the page holds this same registry, so a recipe travels as the list of
 * names it is. A name nothing answers to is a caller error worth failing on
 * rather than a trick to skip quietly: under-stabilizing is how a suite gets a
 * flake it has already paid to prevent.
 */
export function interventionById(id: string): Intervention | undefined {
  return INTERVENTIONS.find((intervention) => intervention.id === id);
}

/**
 * A recipe from the names it travels as.
 *
 * Throws on a name nothing answers to, and names it. The quiet alternative —
 * skip what cannot be resolved — turns a typo in a config into a suite that is
 * one trick less stable than its operator believes, discovered later as a flake
 * they have already paid to prevent. Failing here costs one run and one reading
 * of the message.
 */
export function recipeOf(ids: readonly string[]): Recipe {
  return ids.map((id) => {
    const intervention = interventionById(id);
    if (intervention === undefined) {
      throw new Error(
        `no stabilization trick is called \`${id}\`; this build knows ` +
          INTERVENTIONS.map((known) => `\`${known.id}\``).join(', '),
      );
    }
    return intervention;
  });
}

/** Only the tricks a tier can observe the effect of. */
export function forTier(recipe: Recipe, tier: Tier): Recipe {
  return recipe.filter((intervention) => tierReaches(tier, intervention.needs));
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
