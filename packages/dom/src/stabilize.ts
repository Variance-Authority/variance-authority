import {
  COLLECT_RECIPE,
  featuresOf,
  forDriver,
  forTier,
  recipeCss,
  recipeDigest,
  recipeOf,
  settleRecipe,
  tierOfProfile,
  tierReaches,
  type Digest,
  type ObservationProfile,
  type Recipe,
  type SettleTarget,
  type StepClock,
  type Tier,
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

  /**
   * The media features the held recipe made the browser report, for
   * `collect`'s `features`, or absent when it made it report none.
   *
   * Collection resolves `@media` against declared features rather than asking
   * the browser, so a preference the driver emulated has to be declared here or
   * it is read as unknown. Only a trick the host drove counts.
   */
  readonly features?: Readonly<Record<string, string>>;

  /** Remove the injected sheet. Rarely wanted — see {@link stabilizeForObservation}. */
  readonly release: () => void;

  /**
   * Give focus back to the element `no-focus` took it from.
   *
   * A host that reads a page somebody goes on using — a test that types after
   * it observes, an agent that keeps working in its browser — calls this once
   * the reading, and any photograph of it, is taken. Does nothing when the
   * recipe held no `no-focus`, when nothing was focused, when the element has
   * left the document, or when something else took focus in the meantime.
   */
  readonly refocus: () => void;
}

export interface StabilizeOptions {
  /** Defaults to {@link COLLECT_RECIPE}. */
  readonly recipe?: Recipe;

  /** Defaults to whichever profile the host can support. */
  readonly profile?: ObservationProfile;

  /**
   * The rung this *reading* stands on, when it is higher than the profile's.
   *
   * {@link tierOfProfile} caps at `layout` on purpose: a collection is a
   * reading, and a machine that could photograph is not a reason to charge a
   * reading for a caret nobody is going to photograph. That reasoning holds for
   * every collection taken on its own — and fails for exactly one caller, the
   * in-place capture path, which reads the subject and then screenshots *the
   * same live document*. There the caret will be photographed, by this reading's
   * own sheet, moments later.
   *
   * Without this, `hideCaret` sits in {@link COLLECT_RECIPE} and is filtered out
   * of every call: a focused text input is photographed with its caret blinking,
   * and a suite sees a one-pixel column appear and disappear across runs with no
   * component and no cause attached to it. The raster path meanwhile declines to
   * ask the driver to hide the caret, on the stated grounds that this sheet
   * already governs it.
   *
   * Never raises what the profile can observe — jsdom asking for `raster` still
   * gets jsdom's tier — because a rung is a claim about the host and this is a
   * claim about the reading.
   */
  readonly tier?: Tier;

  /**
   * The driver tricks the host applied to this page before it was read.
   *
   * Reduced motion, a fixed clock and the pointer off the page are applied by
   * the browser driver, not by anything this document can do to itself. A trick
   * in the recipe that the host did not drive is left out of the ids and the
   * digest, so a reading never records a hold it did not have. Absent means
   * the host drove nothing.
   */
  readonly driven?: readonly string[];

  /**
   * Where each wait is taken as a step: the recipe's settles by id, and
   * `frames` for the two frames after a new sheet. Absent takes nothing.
   */
  readonly steps?: StepClock;
}

/** What a host asks of {@link stabilizeAsRequested}, in the shape it crosses into the page. */
export interface StabilizeRequest {
  /** The recipe by id. Absent is the collection recipe. */
  readonly stabilize?: readonly string[];
  /** As {@link StabilizeOptions.tier}. */
  readonly tier?: Tier;
  /** As {@link StabilizeOptions.driven}. */
  readonly driven?: readonly string[];
}

/**
 * {@link stabilizeForObservation} for a request that reached the page as data.
 *
 * A page agent receives the recipe as ids, because an intervention carries
 * functions and cannot be serialized. Rejects on an id nothing answers to, as
 * `recipeOf` throws.
 */
export async function stabilizeAsRequested(
  document: Document,
  request: StabilizeRequest,
  steps?: StepClock,
): Promise<Stabilized> {
  return stabilizeForObservation(document, {
    ...(steps === undefined ? {} : { steps }),
    ...(request.stabilize === undefined ? {} : { recipe: recipeOf(request.stabilize) }),
    ...(request.tier === undefined ? {} : { tier: request.tier }),
    ...(request.driven === undefined ? {} : { driven: request.driven }),
  });
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
  // The reading may stand higher than `tierOfProfile` charges a collection for,
  // but never higher than the host can observe, and never lower than it already
  // stands: a caller asking for less is asking this document to be held less
  // still than the profile says it can be, which is a preference, not a fact
  // about the reading.
  const available = tierOfProfile(profile);
  const ceiling: Tier = profile.raster ? 'raster' : available;
  const asked = options.tier;
  const tier =
    asked !== undefined && tierReaches(ceiling, asked) && tierReaches(asked, available)
      ? asked
      : available;
  const recipe = forDriver(forTier(options.recipe ?? COLLECT_RECIPE, tier), options.driven ?? []);

  if (recipe.length === 0) {
    return { ids: [], digest: undefined, release: () => undefined, refocus: () => undefined };
  }

  // Before the settle steps, because `no-focus` is one of them.
  const focused = recipe.some((intervention) => intervention.governs === 'focus')
    ? deepestFocused(document)
    : undefined;

  const css = recipeCss(recipe);
  const style = existingSheet(document) ?? insertSheet(document);
  const already = style.textContent === css;
  if (!already) style.textContent = css;

  // Applied before the settle steps, so a font that arrives late lands into a
  // page whose animations are already pinned rather than starting one.
  await settleRecipe(recipe, localTarget(), options.steps);

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
  if (!already) {
    await (options.steps === undefined ? settleFrames(view) : options.steps.time('frames', async () => settleFrames(view)));
  }

  const features = featuresOf(recipe);
  return {
    ids: recipe.map((intervention) => intervention.id),
    digest: recipeDigest(recipe),
    ...(features === undefined ? {} : { features }),
    release: () => style.remove(),
    refocus: () => {
      if (focused === undefined || !focused.isConnected || deepestFocused(document) !== undefined) return;
      focused.focus({ preventScroll: true });
    },
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

/**
 * The element holding focus, through open shadow roots, or undefined when
 * nothing but the body does.
 */
function deepestFocused(document: Document): HTMLElement | SVGElement | undefined {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement != null) focused = focused.shadowRoot.activeElement;
  if (focused === null || focused === document.body || focused === document.documentElement) return undefined;
  return 'focus' in focused ? (focused as HTMLElement | SVGElement) : undefined;
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

