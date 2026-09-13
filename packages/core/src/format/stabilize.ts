import { digestValue, type Digest } from './hash.js';
import { tierReaches, type Tier } from './tier.js';
import type { Intervention, PageGlobals, ScreenshotOptions, SettleTarget } from './intervention.js';

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

// Re-exported from here because this is where a reader arrives looking for the
// vocabulary; [`intervention.ts`](./intervention.js) holds the declaration.
export type { Intervention, ScreenshotOptions, SettleTarget, Trick } from './intervention.js';

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

/**
 * A stylesheet rather than the driver's own caret switch, deliberately.
 *
 * Playwright and its peers hide a caret by writing `caret-color` onto every
 * focusable element and putting it back afterwards, and putting it back leaves
 * `style=""` where there was no `style` attribute at all. Any capture that reads
 * the DOM on both sides of a screenshot — which is what the in-place path does
 * to prove the subject held still — then sees markup that moved, and reports the
 * driver's housekeeping as the page being unstable. A page with one text input
 * is enough.
 *
 * So this hold owns the caret the way {@link pinAnimations} owns animations: one
 * stylesheet, installed before the subject is read, removed with the rest of the
 * recipe.
 */
export const hideCaret: Intervention = {
  id: 'hide-caret',
  trick: 'support',
  // A caret paints and does not lay out, so a tier that never rasterizes cannot
  // see it and must not pay to hide it.
  needs: 'raster',
  governs: 'caret',
  because: 'text caret hidden, because it blinks on its own schedule',
  css: '*{caret-color:transparent !important}',
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
  because:
    'waited for images to decode, since their intrinsic size participates in layout, and asked ' +
    'for the ones the browser had deferred',
  settle: async (target) => {
    await target.evaluate(async () => {
      const view = globalThis as unknown as PageGlobals;
      const pending = Array.from(view.document.images).filter((image) => !image.complete);

      const arrived = Promise.all(
        pending.map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
      );

      // Asked for, after the listeners are attached and before anything is
      // awaited. A `loading="lazy"` image outside the viewport has not been
      // requested and will not be until something scrolls, so waiting on it is
      // waiting for a decision the browser has already taken the other way.
      //
      // This is the same act as pinning an animation, not a different kind of
      // thing: what the page shows stops depending on where the viewport
      // happens to be. It matters most for the readings that need it most — a
      // full-page capture of a long page is exactly the case where most of the
      // images are deferred, and photographing it without them yields a picture
      // full of empty boxes whose contents change with the browser's loading
      // heuristics rather than with the product.
      const asServed = pending.map((image) => image.loading);
      for (const image of pending) image.loading = 'eager';

      // Bounded, and it throws when the bound is reached.
      //
      // A response can stall: a CDN that never answers, an image endpoint that
      // deadlocks under its own concurrency, an image the browser deferred and
      // will not request from where the page is scrolled. None of those fire
      // `load` and none fire `error`, so an unbounded wait turns one stuck
      // request into a run that never ends and never says why — not a wrong
      // answer, no answer.
      //
      // Giving up quietly would be worse than the hang in a subtler way: it
      // photographs a page with holes in it and reports the holes as a change,
      // inventing a regression out of the network this trick exists to hold
      // still. Refused instead, naming what it was still waiting for, because
      // "these two never answered" is a finding about the application.
      //
      // The bound is written twice — once as the delay, once in the sentence —
      // because a settle closure is shipped to the page as source text and a
      // constant it named would be a `ReferenceError` on the far side.
      // Held so the loser can be cancelled. A timer left to fire after the
      // images arrived rejects a promise nothing is waiting on any more, which
      // the page reports as an unhandled rejection — this trick's own noise,
      // arriving in the console of every subject it succeeded on.
      let timer: unknown;

      const expired = new Promise<never>((_, reject) => {
        timer = view.setTimeout(() => {
          const stuck = pending.filter((image) => !image.complete);
          reject(
            new Error(
              `${stuck.length} image(s) had not loaded after 15000ms, and neither answered ` +
                `nor failed: ${stuck.map((image) => image.currentSrc || image.src).join(', ')}`,
            ),
          );
        }, 15000);
      });

      try {
        await Promise.race([arrived, expired]);
      } finally {
        view.clearTimeout(timer);

        // Put back, because the trick has to be invisible to the tier that
        // reads the page after it. `loading` is a reflected attribute, so a
        // document whose deferred images were switched to `eager` and left that
        // way is a document that no longer matches the one the product served —
        // and which images were still undecoded when this ran is a question
        // about the network, so the edit lands in some readings and not others.
        // Left in, it makes the same page at two widths disagree about its own
        // markup: this trick filed as a finding against the application.
        for (let index = 0; index < pending.length; index += 1) {
          pending[index]!.loading = asServed[index]!;
        }
      }
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
