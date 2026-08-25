import {
  hashComponents,
  type AccessibilitySnapshot,
  type AttributedRegion,
  type ComponentHash,
  type Diagnostic,
  type Band,
  type Isolation,
  type Level,
  type Raster,
  type RenderDocument,
  type SemanticSnapshot,
  type SourceIndex,
} from '@variance-authority/core';
import { documentDigest, identityDigest } from '@variance-authority/core';
import type { PngDecoder } from '@variance-authority/png';
import {
  describeIdentity,
  type BaselineKey,
  type CompareOptions,
  type RasterComparison,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import { decide, declaredIgnores } from './decide.js';

/**
 * The composition — the phases, wired, and nothing else.
 *
 * Every step below is a function defined elsewhere and testable without this one:
 * acquisition needs a DOM, rendering needs a renderer, comparison needs two PNGs,
 * isolation needs a bitmask, attribution needs a snapshot. Keeping the wiring in
 * its own file is what stops the pipeline from becoming the only place any of it
 * can be exercised — the failure that makes a system with a browser in it
 * untestable in practice.
 *
 * What this file adds is the part that is genuinely about *composition*: which
 * verdicts exist, and which of them are allowed to be `unchanged`.
 */

export type RasterVerdict =
  | 'unchanged'
  | 'changed'
  /** No baseline for this subject. Not a pass, and not a failure. */
  | 'new'
  /**
   * A baseline exists, produced by a different machine.
   *
   * The verdict that keeps the durable mode honest. Comparing across identities
   * yields a large, confident diff caused by a font stack or a driver, which the
   * report would then attribute to whichever component happens to sit under the
   * pixels — so the comparison is refused instead. `unchanged` is never available
   * here: an unobservable difference must never be reported as no difference
   * (ADR-0002, ADR-0008).
   */
  | 'incomparable'
  /**
   * Pixels differed, and every one of them fell inside something the operator
   * excluded (spec 0024).
   *
   * A word of its own rather than `unchanged`, and the distinction is the whole
   * reason ignores are safe to have. It exits `0` — the operator declared this is
   * not the subject, and nothing needs review — while remaining countable, so a
   * suite can be asked how many of its green subjects are green because nobody
   * looked. `unchanged` cannot answer that question and would never be asked it.
   */
  | 'ignored';

export interface Observation {
  readonly subject: string;
  readonly verdict: RasterVerdict;
  /** One sentence stating what happened and why it has this verdict. */
  readonly because: string;

  readonly comparison?: RasterComparison;
  readonly isolation?: Isolation;
  /** Empty unless a snapshot was supplied — geometry alone cannot name a node. */
  readonly regions: readonly AttributedRegion[];

  /** `false` when the image came from the cache rather than from a renderer. */
  readonly rendered: boolean;
  /** Fonts the document declared and the renderer did not have. */
  readonly missingFonts: readonly string[];

  /** The three independently observed boundaries and the retained ARIA diff. */
  readonly signals?: {
    readonly document: 'unchanged' | 'changed';
    readonly pixels: 'unchanged' | 'changed';
    readonly accessibility?: {
      readonly verdict: 'unchanged' | 'changed' | 'incomparable';
      readonly before?: AccessibilitySnapshot;
      readonly after?: AccessibilitySnapshot;
    };
  };

  /**
   * What the operator's ignores took out of this comparison.
   *
   * Present whenever the snapshot carried an excluded subtree, including when it
   * absorbed nothing — because "this run had ignores and they caught nothing" is
   * the state that turns a rule into a blind spot, and a field that vanishes when
   * the count is zero cannot report it.
   */
  readonly ignored?: IgnoredPixels;

  /**
   * The sensitivity that absorbed this subject, and the bands it absorbed.
   *
   * Present only when a declaration decided the verdict — which is what makes it
   * the input a register is built from. The `because` string carries the same
   * facts in prose for a person, and a run that had to parse that prose back out
   * to count anything would be one edit away from counting nothing.
   *
   * Absent on a subject a sensitivity applied to and did *not* absorb, because
   * nothing was relaxed there; the rule's own presence in the config is what
   * lets the register still name it as having absorbed zero.
   */
  readonly relaxed?: {
    readonly rule: string;
    readonly level: Level;
    readonly bands: readonly Band[];
  };

  /**
   * Components whose own content differs from the baseline's (spec 0017).
   *
   * The list `rankRegions` needs, and the reason a baseline carries its component
   * hashes. Without it the ordering falls back to area, which measures
   * displacement rather than cause — an edit that reflows its surroundings moves
   * far more of them than of itself, so the component nothing edited outranks the
   * one that was.
   *
   * Absent when either side has no hashes to compare: a baseline written before
   * they existed, a store that dropped them, or a run with no snapshot. Absent
   * means *unknown*, and a caller must not read it as "nothing caused this".
   */
  readonly causes?: readonly string[];

  /**
   * What this comparison could not do, or did under a condition worth stating.
   *
   * Beside `causes` rather than folded into `because`, for the reason every other
   * diagnostic in this system is a field: a sentence is read once and a code can
   * be counted across a suite. `recordOf` merges these with the collector's own,
   * so a reader meets one list per subject.
   */
  readonly diagnostics?: readonly Diagnostic[];
}

export interface IgnoredPixels {
  /** Changed pixels that fell inside an excluded box. */
  readonly pixels: number;
  /** Boxes that were excluded. Counted, not listed, so a report stays readable. */
  readonly boxes: number;
  /** Boxes covering no changed pixel: the raster half of a dead ignore. */
  readonly inert: number;

  /**
   * Pixels each rule absorbed here, by rule id.
   *
   * A rule present with `0` is the whole reason this is a map rather than a
   * total: a run-level register has to be able to say "`carousel` excluded a
   * subtree in 40 subjects and absorbed nothing in any of them", and a field that
   * only records what was caught can never report a rule that caught nothing.
   */
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Everything a comparison needs that is not a renderer and not a store.
 *
 * Split out because it is a fact about this system worth being able to point at:
 * **the deciding half needs neither.** `decide` reads a snapshot, a policy, a
 * decoder and a set of declarations, and never once asks who painted the images
 * or where they were kept — it was written against `ObserveOptions` only because
 * that is what its callers happened to have.
 *
 * Naming the smaller set makes comparison available to callers that already own
 * both rasters. Every supplied field is still honoured. Evidence a raster-only
 * caller cannot supply — snapshot, exclusions, attribution, and bands — remains
 * absent rather than being guessed.
 */
export interface CompareInputs {
  /**
   * The normalized snapshot of the same render.
   *
   * Optional, and the whole reason to bother. Without it an observation is a
   * pixel count with coordinates — the state of the art, and unassignable. With
   * it every region carries the node it landed on, the component that produced
   * that node, and the landmark path someone would use to describe where it is.
   */
  readonly snapshot?: SemanticSnapshot;
  /** Browser-native accessibility evidence from this acquisition. */
  readonly accessibility?: AccessibilitySnapshot;
  readonly source?: SourceIndex;

  readonly compare?: CompareOptions;

  /**
   * How much of this subject is being asserted on, if it has been relaxed.
   *
   * Resolved by the caller, because scoping is a question about subject ids and
   * tags and this function has one subject and no plan. What arrives is the rule
   * that applies *here*, already matched, or nothing.
   *
   * It decides against the bands the two revisions' component hashes disagree
   * on, which is what a stored baseline can answer for — see `absorbsEntirely`.
   * A baseline carrying no hashes therefore absorbs nothing and the subject is
   * reported in full, which is the correct direction: a declaration that cannot
   * be evaluated must not be assumed to have been satisfied.
   */
  readonly sensitivity?: {
    readonly rule: string;
    readonly reason: string;
    readonly level: Level;
  };

  /**
   * How PNG bytes become pixels. Defaults to `pngjs`, which requires nothing.
   *
   * Decoding is 90% of a comparison (journal 0016), so this is the single
   * largest lever on raster cost — `@variance-authority/png-sharp` measures 1.5×
   * per image and 12× when several decode at once, because libvips runs off the
   * event loop. It is a separate package because it is a native addon, and a
   * consumer that cannot load one keeps the default rather than losing the
   * comparison.
   */
  readonly decoder?: PngDecoder;
  /** Grid at which neighbouring changed pixels count as one place. */
  readonly cell?: number;
  readonly limit?: number;

  /**
   * Difference shapes to absorb, as `fingerprint → rule id` (spec 0024).
   *
   * The half of an ignore that a place cannot express: a flake that moves has no
   * stable node to name, and a rectangle drawn where it was last seen silences
   * whatever lands there next. A shape follows the artifact instead, so a
   * *different* regression in the same place still has a different fingerprint
   * and is still reported.
   *
   * Applied after isolation, because a fingerprint is a property of a clustered
   * region rather than of a pixel — which also means it can only absorb what the
   * isolation actually returned, and a truncated tail is never silently absorbed.
   */
  readonly ignoreShapes?: Readonly<Record<string, string>>;
}

/** {@link CompareInputs}, plus the two things a render needs. */
export interface ObserveOptions extends CompareInputs {
  readonly renderer: Renderer;
  readonly store: RasterStore;
}

/**
 * Two images that are already in hand, decided against each other.
 *
 * The same function every other path in this package ends at, reachable without
 * a renderer or a store. `observePair` renders two documents and calls it;
 * `observeAgainstBaseline` renders one and looks the other up; this one is for
 * the caller who has both and no document behind either.
 *
 * `rendered` is `false` and cannot be otherwise: nothing was painted here, and a
 * run reporting otherwise would be claiming a render cost it did not pay.
 *
 * What it *cannot* do is not hidden by this entry point — it is decided by what
 * the two rasters carry. No `components` on either side means no causes; no
 * snapshot means no attribution, no exclusions and no bands. Each of those is
 * already an `undefined` that `decide` handles by saying less, so the reduction
 * arrives as absent fields in the observation rather than as a second code path.
 *
 * **The identities are checked here, and nowhere else could do it.** The two
 * other paths get comparability for free — `observePair` renders both sides with
 * one renderer in one run, and `observeAgainstBaseline` gets it from the store
 * lookup, which knows what a baseline was written under. This one is handed two
 * rasters from anywhere, so it is the only entry point where a caller can
 * compare a WebKit baseline against a Chromium run, or an iOS simulator capture
 * against a Figma export. Pixels are machine-bound; two identities is one word,
 * and the alternative is a wall of red with no cause attached to it.
 */
export async function observeRasters(
  subject: string,
  before: Raster,
  after: Raster,
  options: CompareInputs = {},
): Promise<Observation> {
  if (identityDigest(before.identity) !== identityDigest(after.identity)) {
    return {
      subject,
      verdict: 'incomparable',
      because:
        `\`${subject}\` was given two images from different painters: ` +
        `${describeIdentity(before.identity)} and ${describeIdentity(after.identity)}; ` +
        'pixels are machine-bound, so the two are not comparable',
      regions: [],
      rendered: false,
      missingFonts: [],
    };
  }

  return await decide(subject, before, after, false, options);
}

/**
 * **Ephemeral**: render both sides now, compare, keep nothing.
 *
 * No baseline, no store, no pinned machine — the two images come from one
 * renderer in one run, so the machine-bound inputs are identical by construction
 * rather than by container. This is the cheap mode and it is cheap because it
 * removes a requirement instead of satisfying it.
 */
export async function observePair(
  before: RenderDocument,
  after: RenderDocument,
  options: ObserveOptions,
): Promise<Observation> {
  const left = await renderOnce(options.renderer, options.store, before);
  const right = await renderOnce(options.renderer, options.store, after, componentsOf(options));

  return await decide(after.subject.id, left.raster, right.raster, left.rendered || right.rendered, options);
}

/**
 * **Durable**: render this side, compare against a stored baseline.
 *
 * The baseline is looked up under *any* identity and the comparability check is
 * explicit, so a run on the wrong machine says so in one sentence instead of
 * failing every subject for reasons nobody can attribute.
 *
 * The key is `identityFor(document)`, never `renderer.identity`: the raster this
 * run is about to produce will be *written* under the former, and a lookup that
 * asks a different question from the write it is trying to find answers it
 * wrong in both directions — see {@link Renderer.identityFor}.
 */
export async function observeAgainstBaseline(
  document: RenderDocument,
  key: BaselineKey,
  options: ObserveOptions,
): Promise<Observation> {
  const identity = options.renderer.identityFor(document);

  const components = componentsOf(options);
  const found = await options.store.find(key, identity);
  const fresh = await renderOnce(
    options.renderer,
    options.store,
    document,
    components,
    options.accessibility,
  );

  // Carried on the paths that never reach a comparison. What the operator
  // excluded is a fact about this subject whether or not anything was compared,
  // and a run that omitted it told the ledger the rule had resolved nowhere.
  const declared = declaredIgnores(options.snapshot, fresh.raster.identity.deviceScaleFactor);
  const declaredField = declared === undefined ? {} : { ignored: declared };

  if (found === null) {
    return {
      subject: document.subject.id,
      verdict: 'new',
      because: `no baseline for \`${key.subject}\` under this renderer; nothing to compare against`,
      regions: [],
      rendered: fresh.rendered,
      missingFonts: fresh.raster.missingFonts,
      ...declaredField,
    };
  }

  if (!found.comparable) {
    return {
      subject: document.subject.id,
      verdict: 'incomparable',
      because:
        `a baseline for \`${key.subject}\` exists but was rendered by ` +
        `${describeIdentity(found.storedUnder)}, and this run is ${describeIdentity(identity)}; ` +
        'pixels are machine-bound, so the two are not comparable',
      regions: [],
      rendered: fresh.rendered,
      missingFonts: fresh.raster.missingFonts,
      ...declaredField,
    };
  }

  return await decide(document.subject.id, found.raster, fresh.raster, fresh.rendered, options);
}

/**
 * This render's component hashes, when a snapshot of it was supplied.
 *
 * Computed here rather than by the collector so that the hashes and the pixels
 * come from one mount by construction: a collector that hashed separately could
 * hash a document the renderer never saw, and the ordering would then be about a
 * page that was not painted.
 */
function componentsOf(options: ObserveOptions): readonly ComponentHash[] | undefined {
  return options.snapshot === undefined ? undefined : hashComponents(options.snapshot);
}

/**
 * Render this document, unless an identical one has already been rendered.
 *
 * The deferral lever (Principle 4): content addressing makes "identical" a fact
 * about the document rather than a guess about the branch, so a rebase, a file
 * move, or a rerun costs nothing and a run over 300 subjects where two changed
 * pays for two images.
 *
 * Both halves key on `identityFor`, and the emphasis is earned: the raster
 * package once shipped a `renderCached` that read under `renderer.identity` and
 * wrote under the raster's own. Those differ by exactly the scale factor, so
 * above 1x the cache could never hit its own write and the lever was off
 * precisely where images are most expensive. That function is gone rather than
 * fixed — this is the loop a run actually takes, and one of the two was always
 * going to rot.
 */
async function renderOnce(
  renderer: Renderer,
  store: RasterStore,
  document: RenderDocument,
  /** This document's component hashes, folded into the raster it produces. */
  components?: readonly ComponentHash[],
  accessibility?: AccessibilitySnapshot,
): Promise<{ raster: Raster; rendered: boolean }> {
  const identity = renderer.identityFor(document);
  const hit = await store.renderCache.get(documentDigest(document), identity);

  // A cache hit is an image of exactly this document, so the hashes computed
  // *here* describe it as well as the ones written with it did. What the cache
  // kept is discarded either way — see `withComponents`.
  if (hit !== null) {
    return { raster: withEvidence(hit, components, accessibility), rendered: false };
  }

  const painted = await renderer.render(document);
  // Pixels only. A render cache is addressed by document digest and holds
  // *images*; component hashes describe a snapshot, which carries provenance a
  // document does not, so two different snapshots share one cache key. Storing
  // them here is what let a warm machine answer with a previous run's hashes —
  // and, because `images.ts` builds the candidate sidecar out of this cache, what
  // would have let `accept` promote a baseline whose hashes belong to a document
  // it is not an image of.
  await store.renderCache.put(painted);
  return { raster: withEvidence(painted, components, accessibility), rendered: true };
}

/**
 * Stamp this run's component hashes onto a raster, and remove anybody else's.
 *
 * The removal is the important half, and it was missing. A render cache is keyed
 * by document digest, and component hashes are not derived from the document —
 * they are derived from the *snapshot*, which carries provenance the document
 * does not. So a cache entry can legitimately hold hashes computed from a
 * different snapshot of the same bytes: rename a component, change nothing it
 * renders, and the digest holds while the hashes move.
 *
 * Left in place, that makes the answer a function of cache warmth. A run with no
 * snapshot returns whatever the cache kept and reports causes; the same run on a
 * cold machine returns none and reports none. ADR-0027 chose *carry* over *fetch*
 * precisely so that ranking could not depend on that, and this is the same
 * failure arriving one layer down.
 *
 * So the rule is unconditional: the hashes on a raster are the ones this run
 * computed, or there are none.
 */
function withEvidence(
  raster: Raster,
  components: readonly ComponentHash[] | undefined,
  accessibility: AccessibilitySnapshot | undefined,
): Raster {
  const { components: staleComponents, accessibility: staleAccessibility, ...pixels } = raster;
  void staleComponents;
  void staleAccessibility;
  return {
    ...pixels,
    ...(components === undefined ? {} : { components }),
    ...(accessibility === undefined ? {} : { accessibility }),
  };
}
