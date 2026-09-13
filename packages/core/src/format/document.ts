import type { Diagnostic, SubjectRef } from './capture.js';
import type { Viewport } from './environment.js';
import { digestValue, type Digest } from './hash.js';
import type { ComponentHash } from './snapshot.js';

/**
 * The render document: what gets *sent* somewhere to become an image.
 *
 * This is the acquisition phase's output and the only thing the rendering side
 * ever sees. It is plain serializable data for the same reason `RawCapture` is
 * (ADR-0006): the renderer may be a page in this process, a browser on this
 * machine, or a pinned container two networks away, and no code upstream of it
 * may assume which.
 *
 * Two routes produce one of these, and the point of the type is that they are
 * interchangeable:
 *
 * 1. **jsdom → document → render elsewhere.** jsdom cannot rasterize. It can
 *    describe exactly what to rasterize, which is the sub-renderer split ADR-0002
 *    asks for: the cheap tier decides almost everything, and the residue is
 *    handed to something that owns a GPU.
 * 2. **playwright → document → render on a server.** The same payload, acquired
 *    from a real engine. Used when the *deciding* machine and the *pinned*
 *    machine are different, which is the case every CI setup actually has.
 *
 * A browser may instead capture a `Raster` in place. That is the sibling branch
 * of `CaptureMaterial`, not a third route that somehow produces this type.
 *
 * ## Why this is small
 *
 * `css` holds the *applicable* rules only — the pruning of ADR-0003, which on
 * `@variance-authority/dom`'s accretion fixture takes 1010 rules to 1. That
 * number is a cost claim as much as a
 * correctness one: shipping a document over a network hop is only sensible if the
 * document is not the entire design system plus Storybook's chrome.
 */
export interface RenderDocument {
  readonly documentVersion: 1;
  readonly subject: SubjectRef;

  /**
   * The subject subtree, serialized.
   *
   * Serialized rather than referenced by URL: a URL makes the renderer
   * responsible for reproducing the application's state, which it cannot do and
   * should not try. What is sent is the markup that existed at the moment of
   * capture, which is the only definition of "this render" that survives a hop.
   */
  readonly html: string;

  /**
   * The ancestor context the subject was rendered inside.
   *
   * Not decoration. Pruning keeps rules like `html.dark .card` and
   * `.app .list > li`, whose left-hand side lives *above* the subject — render
   * the subtree bare and those rules match nothing, so the image is missing
   * exactly the styling the collector went to the trouble of proving applies.
   *
   * Reproduced as empty open tags rather than by re-rendering the application:
   * what a selector needs is a chain of elements with the right tags, ids,
   * classes, and attributes, and nothing above the subject contributes anything
   * else to it that {@link RenderDocument.inherited} does not already carry.
   */
  readonly frame: RenderFrame;

  /**
   * Applicable stylesheet text, in cascade order.
   *
   * Order is load-bearing and is the caller's to preserve — the cascade breaks
   * specificity ties by document order, so a set that arrives shuffled paints
   * differently while hashing the same if this were a set rather than a list.
   */
  readonly css: readonly string[];

  readonly viewport: Viewport;

  /**
   * Inherited values in force at the subject root, applied to its wrapper.
   *
   * The same requirement as `RawCapture.inheritedSeed` and for the same reason:
   * pruning drops rules on ancestors outside the subtree, and a font-size
   * inherited from `<html>` is not optional decoration — dropping it changes
   * every metric in the image.
   */
  readonly inherited: Readonly<Record<string, string>>;

  /**
   * Fonts the acquiring side observed as loaded.
   *
   * Carried, not resolved. A renderer that lacks one of these will substitute
   * and produce different metrics, and that has to be *detectable* rather than
   * silently absorbed — see {@link RenderIdentity}.
   */
  readonly fonts: readonly string[];

  /** External references, url → content hash. Present so a swap is visible. */
  readonly assets?: Readonly<Record<string, string>>;

  /**
   * Base against which relative resource references were resolved.
   *
   * Preserves relative-reference resolution for either document kind. Resource
   * closure is denoted by `resources`, not by the presence of this field.
   */
  readonly baseUrl?: string;

  /**
   * Immutable responses needed to paint this document, keyed by absolute URL.
   *
   * Presence — including an empty object — means the document is
   * resource-closed: a renderer must not consult the network for a missing URL.
   * Absence preserves the older network-capable document contract and must not
   * be described as portable to another machine.
   */
  readonly resources?: Readonly<Record<string, RenderResource>>;

  readonly diagnostics: readonly Diagnostic[];
}

export interface RenderResource {
  readonly contentType: string;
  /** Response bytes, base64. */
  readonly bytes: string;
  readonly digest: Digest;

  /**
   * The status a renderer answers this URL with. Absent means 200.
   *
   * A subject is allowed to reference something that is not there: a fallback
   * test does it on purpose, and the browser it was acquired in painted the
   * broken state rather than the image. Recording the failure as a failure is
   * what lets a renderer reproduce that state without asking the network.
   */
  readonly status?: number;
}

export interface RenderFrame {
  /** Attributes on `<html>`. `class="dark"` here decides half a design system. */
  readonly html: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, string>>;
  /** Elements between `<body>` and the subject root, outermost first. */
  readonly ancestors: readonly FrameElement[];

  /**
   * Used width of the subject's parent box, in CSS pixels, when layout was
   * observable.
   *
   * A subject declaring `width: 100%` is a different size in a 1024px page and
   * inside a 600px panel, and nothing else in this document says which it was.
   * Absent under a profile with no layout engine, in which case the render falls
   * back to the viewport and the difference, if any, is real rather than hidden.
   */
  readonly containerWidth?: number;
}

export interface FrameElement {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Content address of a document: *what is to be painted*.
 *
 * This is the deferral lever. Rendering is the expensive phase, and a document
 * whose digest has been rendered before under the same identity has an image
 * already — so the cheapest render is the one that is skipped. Nothing about the
 * branch, the commit, or the file path enters this (Principle 4), so moving a
 * story between files does not cost a re-render.
 *
 * Deliberately covers `viewport` in full, `deviceScaleFactor` included: unlike
 * the semantic key (ADR-0010), a raster genuinely differs at 2x and the whole
 * purpose of this digest is to address the raster.
 *
 * **Limit, stated rather than discovered.** Declaration values arrive serialized
 * by the acquiring engine's CSSOM — jsdom writes `rgb(18, 52, 86)` where the
 * author wrote `#123456` — and this phase deliberately does not canonicalize
 * them, because a collector that normalizes is a second ruleset versioned by
 * nothing (ADR-0001). So two engines can address the same page differently. That
 * makes a render cache *per acquiring engine*, which is a missed cache hit and
 * never a wrong image.
 */
export function documentDigest(document: RenderDocument): Digest {
  return digestValue({
    documentVersion: document.documentVersion,
    html: document.html,
    frame: {
      html: { ...document.frame.html },
      body: { ...document.frame.body },
      ancestors: document.frame.ancestors.map((element) => ({
        tag: element.tag,
        attributes: { ...element.attributes },
      })),
      ...(document.frame.containerWidth !== undefined
        ? { containerWidth: document.frame.containerWidth }
        : {}),
    },
    css: [...document.css],
    viewport: { ...document.viewport },
    inherited: { ...document.inherited },
    fonts: [...document.fonts],
    ...(document.assets ? { assets: { ...document.assets } } : {}),
    ...(document.baseUrl !== undefined ? { baseUrl: document.baseUrl } : {}),
    ...(document.resources !== undefined
      ? {
          resources: Object.fromEntries(
            Object.entries(document.resources).map(([url, resource]) => [
              url,
              { ...resource },
            ]),
          ),
        }
      : {}),
  });
}

/**
 * Who painted it.
 *
 * The durable half of this system rests on one requirement — *images compared
 * against each other must come from the same machine* — and a requirement that
 * is merely stated gets violated by a CI runner upgrade nobody announced. This
 * makes it a value, so it can be compared rather than assumed.
 *
 * Every field is something that has been observed to move pixels without moving
 * markup. None of them is a guess about what *might* matter.
 */
export interface RenderIdentity {
  /** `playwright-chromium@1.49.0`, `remote:render.internal`, … */
  readonly renderer: string;
  /** Engine build. A Chromium bump repaints text; that is not a regression. */
  readonly engine: string;
  /** OS and architecture. Font rasterization differs across both. */
  readonly platform: string;
  readonly deviceScaleFactor: number;
  /**
   * Fonts the *renderer* actually has.
   *
   * Compared against {@link RenderDocument.fonts} at render time, because a
   * substituted font is the single most common way two machines disagree, and
   * it is invisible in every artifact except the image itself.
   */
  readonly fonts: readonly string[];

  /**
   * Digest of what the renderer did *to* the page so it could be observed.
   *
   * Pausing animations, hiding a caret, waiting for fonts — each is necessary
   * and each widens the gap between what was measured and what a person sees.
   * The gap itself is acceptable; a *difference* in it between two runs is not,
   * because the images then differ for a reason that is not the code and the
   * report blames whichever component sits under the pixels. Folding it in here
   * makes that comparison `incomparable` instead, by the same mechanism that
   * refuses a cross-machine one.
   *
   * Optional only because a renderer may predate the field. Absent means the
   * renderer did not record what it did, which is emphatically not the same as
   * "it did nothing" — and two such renderers will compare, which is the hazard
   * that argues for every renderer setting it.
   */
  readonly stabilization?: Digest;

  /**
   * Digest of pixel-affecting browser launch and raster settings.
   *
   * Separate from stabilization: one describes how the browser paints, the
   * other what was done to the page before it was read.
   */
  readonly rasterization?: Digest;
}

export function identityDigest(identity: RenderIdentity): Digest {
  return digestValue({
    renderer: identity.renderer,
    engine: identity.engine,
    platform: identity.platform,
    ...(identity.stabilization !== undefined ? { stabilization: identity.stabilization } : {}),
    ...(identity.rasterization !== undefined ? { rasterization: identity.rasterization } : {}),
    deviceScaleFactor: identity.deviceScaleFactor,
    fonts: [...identity.fonts],
  });
}

/**
 * A rendered image and the conditions it was produced under.
 *
 * `bytes` is base64 rather than a `Buffer` so the whole value survives the same
 * hops the document does. A raster that could only exist in Node would make the
 * remote route a special case in every function that touches one.
 *
 * The image is optional, and the three fields that describe it move together.
 * A subject that occupies no pixels — a wrapper whose only child went to a
 * portal, a `describeConformance` mount with no children — still has a
 * document, rules, components and an accessibility tree, all of which compare.
 * Refusing to photograph it is right; refusing the subject reported a quarter
 * of Material UI's unit tier as unobserved over an axis nothing was asking
 * about. Absent here means *this subject has no pixels to observe*, which is a
 * measurement; it never means *the image was lost*.
 */
export interface Raster {
  readonly documentDigest: Digest;
  readonly identity: RenderIdentity;
  /**
   * Device pixels. `width / viewport.width` is the scale, and is asserted.
   *
   * Absent exactly when {@link bytes} is, and {@link pictured} is the one place
   * that reads the three together.
   */
  readonly width?: number;
  readonly height?: number;
  /** PNG, base64. Absent when the subject occupies no pixels. */
  readonly bytes?: string;
  /** Fonts the document declared that the renderer did not have. */
  readonly missingFonts: readonly string[];

  /**
   * The browser-computed accessibility tree from the acquisition that produced
   * this candidate. It is independent evidence: pixel equality cannot settle it.
   * Absent means the acquisition host did not observe this boundary.
   */
  readonly accessibility?: import('./accessibility.js').AccessibilitySnapshot;

  /**
   * What the document that painted this said about its own components (ADR-0018).
   *
   * The field that makes a baseline self-describing, and the reason it is here
   * rather than only in a history store. Separating the component that *caused* a
   * change from the components the change merely moved needs both revisions, and
   * a stored baseline is an image: without this, a run has one document and ranks
   * by area — which
   * [journal 0013](../../../../docs/context/journal/0013-observability.md)
   * measured as backwards.
   *
   * Text, and small: one line per component boundary. It rides in the sidecar
   * beside a PNG that dominates it, so a baseline carries its own explanation
   * wherever it is copied, and a store or a transport that drops it degrades to
   * ranking by area rather than to a wrong answer.
   *
   * Optional because a baseline written before this existed does not have it, and
   * because a profile or a collector that supplies no snapshot cannot produce it.
   * Absent means *unknown*, never *no components*.
   */
  readonly components?: readonly ComponentHash[];

  /**
   * What inspection found in the document that painted this, as marks.
   *
   * The field that lets a later run say *this defect was already here* instead of
   * printing every defect it finds with no indication of when it arrived. A
   * finding is produced from one render with no baseline consulted — that is the
   * point of having one — and the consequence is that the list is identical on
   * the run that introduced a defect and on the two hundred runs after it. A
   * reviewer reading `a control inside another control` has no way to tell an
   * inherited condition from something they just wrote, and the two are different
   * decisions.
   *
   * Marks rather than findings, from {@link findingMark}. The sentence, the
   * landmark phrase and the source line are all rewritten by edits that do not
   * touch the defect, so storing them would report a defect as new every time the
   * copy beside it changed — and they are the bulk of the bytes, in a sidecar
   * that is committed beside every baseline.
   *
   * **Absent means nothing inspected it, never that it was clean.** A baseline
   * written before this existed, or by a collector that supplies no snapshot, has
   * no list, and a run that read absence as `[]` would announce every standing
   * defect in the suite as newly introduced on the first run after an upgrade.
   */
  readonly findingMarks?: readonly string[];
}

/**
 * A raster whose image is in hand.
 *
 * Every pixel comparison in the codebase needs all three of `bytes`, `width`
 * and `height`, and they are absent together or present together. Narrowing
 * them one at a time is how a caller ends up reading the bytes of a subject
 * that was never photographed, so the narrowing lives here and is done once.
 */
export type Pictured = Raster & {
  readonly width: number;
  readonly height: number;
  readonly bytes: string;
};

/** Whether this record carries an image, narrowing all three fields together. */
export function pictured(raster: Raster): raster is Pictured {
  return raster.bytes !== undefined && raster.width !== undefined && raster.height !== undefined;
}

/**
 * Whether the subject occupied any pixels, answered without the image.
 *
 * The question {@link pictured} cannot be asked of a sidecar. Bytes live in a
 * separate file, row or object, so a record read without them carries the width
 * and the height and nothing else — and those *are* the store's record of
 * whether there was ever anything to photograph, which is why `sidecarFrom`
 * refuses a sidecar carrying one of them.
 *
 * So: this for a record, {@link pictured} for an image in hand. A caller that
 * reached for `pictured` here would read every sidecar in the store as a subject
 * with no pixels, because none of them have bytes.
 */
export function occupiesPixels(raster: Omit<Raster, 'bytes'>): boolean {
  return raster.width !== undefined && raster.height !== undefined;
}

/**
 * The image, or a refusal naming the subject that has none.
 *
 * For the paths where a missing image is a programming error rather than a
 * measurement — a diff, a PNG encode — so they read as assertions instead of
 * as a non-null assertion nobody can audit.
 */
export function picture(raster: Raster, subject: string): Pictured {
  if (!pictured(raster)) {
    throw new Error(
      `\`${subject}\` occupies no pixels, and this path needs an image; ` +
        'a subject with no raster compares on its document alone',
    );
  }
  return raster;
}
