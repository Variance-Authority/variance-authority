import {
  COLLECT_RECIPE,
  forTier,
  recipeCss,
  recipeDigest,
  settleRecipe,
  tierOfProfile,
  type Digest,
  type ObservationProfile,
  type Recipe,
  type SettleTarget,
} from '@variance-authority/core/format';
import { detectProfile } from './profile.js';

/**
 * Hold the page still *before the subject is observed*, not before it is painted.
 *
 * ## The gap this closes
 *
 * The computed-style allowlist excludes `animation-*` and `transition-*` on the
 * stated grounds that a snapshot is taken "at a declared settle point with
 * animation disabled". Nothing disabled it. `transform`, `opacity`, `filter`,
 * `color` and every geometric longhand *are* admitted, so a subject collected
 * 120ms into a 300ms fade produced a snapshot of a frame no reviewer would
 * recognise — and the next run, collected 180ms in, reported a change with a
 * component name and a source file attached.
 *
 * That is worse than an unexplained pixel diff, because it is credible. A
 * reviewer reads "Card moved at `opacity`, `src/Card.tsx:14`" and looks for the
 * edit. There is no edit. It is the row `flakiness.md` marks *absorbed by
 * nothing* and the one a first run is most likely to hit.
 *
 * ## Where the damage lands, and why it is invisible
 *
 * One `<style>` element, marked with {@link STABILIZE_ATTRIBUTE} and skipped by
 * `indexStyleSheets` — so the tool's own rules never enter a capture, never
 * match a node, and never appear in anybody's attribution. Deleting this module
 * deletes the intervention completely, which is the property the intervention
 * vocabulary claims for the cheapest tier of damage and would not have had if
 * the sheet were collected like any other.
 *
 * What *does* survive into the capture is the effect: `transform` reads its
 * first frame rather than a frame off the clock. That is the point, and it is
 * why {@link stabilizeForObservation} returns a digest for
 * `EnvironmentInputs.stabilization`. A baseline collected untouched and a run
 * collected held still are two baselines, not a diff — the alternative is one
 * confident wrong answer per animated node.
 */

/**
 * Marks the sheet this module injects, so the collector can skip it.
 *
 * A `data-` prefix because it is an attribute on a real element in the
 * adopter's page, and the page belongs to them. Exported because the skip and
 * the injection must not drift: two spellings of this string is a stabilization
 * sheet collected as content, which shows up as `*` matching every node in the
 * subject.
 */
export const STABILIZE_ATTRIBUTE = 'data-va-stabilize';

export interface Stabilized {
  /** Ids actually applied, in recipe order. Empty when the tier could observe none. */
  readonly ids: readonly string[];

  /**
   * `EnvironmentInputs.stabilization`, or `undefined` when nothing was applied.
   *
   * Undefined rather than the digest of an empty recipe: *observed untouched* is
   * a state the environment key should record as absent, and an empty-list
   * digest is a confident-looking value that says the opposite.
   */
  readonly digest: Digest | undefined;

  /** Remove the injected sheet. Rarely wanted — see {@link stabilizeForObservation}. */
  readonly release: () => void;
}

export interface StabilizeOptions {
  /** Defaults to {@link COLLECT_RECIPE}. */
  readonly recipe?: Recipe;

  /** Defaults to whichever profile the host can support. */
  readonly profile?: ObservationProfile;
}

/**
 * Apply a collection recipe to a live document.
 *
 * **Idempotent by element, not by call.** The sheet is found and rewritten
 * rather than appended, because a session that collects thirty subjects through
 * one document would otherwise accumulate thirty identical stylesheets — each
 * one more sheet for every later subject's index to walk past.
 *
 * The sheet is deliberately *left in place*. Removing it between subjects would
 * restart every animation the moment the next subject is about to be read,
 * which is the failure this exists to prevent, run once per subject. `release`
 * exists for a caller who owns the page and wants it back.
 */
export async function stabilizeForObservation(
  document: Document,
  options: StabilizeOptions = {},
): Promise<Stabilized> {
  const view = document.defaultView;
  const profile = options.profile ?? detectProfile(view);
  const recipe = forTier(options.recipe ?? COLLECT_RECIPE, tierOfProfile(profile));

  if (recipe.length === 0) {
    return { ids: [], digest: undefined, release: () => undefined };
  }

  const css = recipeCss(recipe);
  const style = existingSheet(document) ?? insertSheet(document);
  const already = style.textContent === css;
  if (!already) style.textContent = css;

  // Applied before the settle steps, so a font that arrives late lands into a
  // page whose animations are already pinned rather than starting one.
  await settleRecipe(recipe, localTarget());

  // Two frames, because one is not enough to be sure. The first flushes the
  // style change; the second is when a compositor-driven animation that was
  // mid-flight has been re-resolved against `animation-delay` and come to rest
  // where the recipe put it. Reading computed style between the two returns the
  // frame we were trying to leave.
  //
  // **Skipped when the sheet was already in force**, which is every subject
  // after the first in a session that reuses one document. There is no style
  // change to flush and nothing has been unpinned in the meantime — an animation
  // paused at its first frame stays there.
  //
  // Measured by `stabilization.chromium.test.ts`: with the skip, an untouched
  // collection is 2.3 ms/subject against 2.6 held still, which is noise. The
  // cost of *not* skipping is bounded rather than read — two frames at 60Hz is
  // ~32 ms a subject, six seconds on two hundred — because no arrangement of the
  // `stabilize` option reaches the unconditional path from outside. The test
  // carries a todo saying so.
  //
  // The condition is *the CSS is unchanged* rather than a counter somebody has
  // to keep correct, so the saving is a property of the sheet being idempotent
  // and not of anybody remembering to reset something.
  if (!already) await settleFrames(view);

  return {
    ids: recipe.map((intervention) => intervention.id),
    digest: recipeDigest(recipe),
    release: () => style.remove(),
  };

  /**
   * `evaluate` that simply calls, because the page is this realm.
   *
   * The settle steps are written against a `SettleTarget` so the renderer can
   * ship them across a `page.evaluate`. In the page agent there is no boundary
   * to cross, and pretending there is one would mean serializing a closure to
   * hand it back to the same document it came from.
   */
  function localTarget(): SettleTarget {
    return { evaluate: async <T,>(fn: () => T | Promise<T>): Promise<T> => await fn() };
  }
}

function existingSheet(document: Document): HTMLStyleElement | null {
  return document.querySelector<HTMLStyleElement>(`style[${STABILIZE_ATTRIBUTE}]`);
}

function insertSheet(document: Document): HTMLStyleElement {
  const style = document.createElement('style');
  style.setAttribute(STABILIZE_ATTRIBUTE, '');
  // Last in `head`, so it loses to nothing on document order — every declaration
  // it carries is `!important` anyway, and an `!important` author rule that
  // arrives later still wins among equals.
  (document.head ?? document.documentElement).append(style);
  return style;
}

/**
 * Two animation frames, or nothing at all where there are none.
 *
 * jsdom implements `requestAnimationFrame` only when `pretendToBeVisual` is set,
 * and a host without it has no animation clock to wait for either — so the
 * absence is the answer rather than a reason to poll a timer.
 */
async function settleFrames(view: Window | null): Promise<void> {
  if (view === null || typeof view.requestAnimationFrame !== 'function') return;
  await new Promise<void>((resolve) => {
    view.requestAnimationFrame(() => {
      view.requestAnimationFrame(() => resolve());
    });
  });
}

