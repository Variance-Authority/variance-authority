import {
  admits,
  type Diagnostic,
  type Digest,
  type ObservationProfile,
  type Provenance,
  type RawCapture,
  type RawNode,
  type SubjectRef,
  type Viewport,
  type Wiring,
} from '@variance-authority/core';
import { ariaOf } from './aria.js';
import { resolveIgnores, type IgnoreSelector } from './ignore.js';
import { conditionKey, indexStyleSheets, matchRulesFor, type StyleIndex } from './css.js';
import { inheritedSeed } from './inherit.js';
import type { ConditionEnvironment } from './media.js';
import { attributesOf, childNodesOf, elements, propertyNames } from './dom-list.js';
import { detectProfile } from './profile.js';
export { detectProfile } from './profile.js';

/**
 * Extract a `RawCapture` from a live DOM.
 *
 * One implementation serves both observation profiles. The alternative — a JSDOM
 * collector and a Chromium collector — would mean two extraction paths that must
 * agree, maintained by discipline. Here the only difference is which dimensions
 * the profile declares observable, and the code reads that declaration rather
 * than branching on the host.
 *
 * The collector's job is *extraction*, not cleanup. Values leave here as
 * authored: generated ids intact, hashed class names intact, shorthands
 * unexpanded, cascade losers retained. Normalization is `core`'s, so that it is
 * versioned by the ruleset rather than by each collector (ADR-0001).
 *
 * The one exception is applicability pruning, which cannot be anywhere else:
 * deciding whether a rule applies requires asking a live DOM.
 */

export interface CollectOptions {
  readonly subject: SubjectRef;
  readonly viewport: Viewport;

  /** Engine identity for the environment key, e.g. `chromium@131.0.6778.33`. */
  readonly engine: string;

  /**
   * Owner chain provider, usually `provenanceOf` from
   * `@variance-authority/react`.
   *
   * Injected rather than imported so the collector carries no framework
   * dependency — the same seam other frameworks arrive through later (spec §9).
   */
  readonly provenanceOf?: (element: Element) => Provenance | undefined;

  /**
   * Framework wiring provider, usually `wiringOf` from
   * `@variance-authority/react`.
   *
   * A second injection point rather than a field on `provenanceOf`'s return,
   * because the two answer to different readers and a project may want either
   * without the other: provenance makes a diff carry a name, wiring is a
   * dimension of the subject. Absent leaves the band absent, which is what a
   * page with no framework adapter should look like (ADR-0002).
   */
  readonly wiringOf?: (element: Element) => Wiring | undefined;

  /**
   * Fonts in play, as `family/weight/style/contentHash`.
   *
   * Must be supplied by the caller. A page cannot read the bytes of a font it
   * was given, so the collector can observe that `Inter` is in use but not
   * *which* Inter — and a font substitution changes metrics, and therefore
   * geometry, without changing a line of code. Defaulting this would put a
   * confident-looking value in the environment key that guarantees nothing;
   * see the diagnostic emitted when it is omitted.
   */
  readonly fonts?: readonly string[];

  /**
   * Elements this subject renders through portals, usually `portalContentOf`
   * from `@variance-authority/react`.
   *
   * Without it a portalled subtree is invisible: the subject's own container is
   * byte-identical whether a modal is open or closed, so an opening dialog reads
   * as `unchanged`. Omitting this on a subject that uses portals is a silent
   * false negative, which is why the collector reports `portals-not-resolved`
   * when no provider is supplied (ADR-0007).
   */
  readonly portalsOf?: (root: Element) => readonly Element[];

  /** Extra media features to evaluate against, e.g. `prefers-reduced-motion`. */
  readonly features?: Readonly<Record<string, string>>;

  /** Content hashes for external assets, keyed by request URL. */
  readonly assets?: Readonly<Record<string, string>>;

  /**
   * Identity of the stabilization recipe this page was held still with, from
   * `stabilizeForObservation`.
   *
   * Passed in rather than detected, because the collector cannot tell the
   * difference between a page that was pinned and a page with nothing to pin —
   * both look like a document with no animation running. Omitting it on a page
   * that *was* stabilized is the dangerous direction: two recipes then share one
   * baseline and their disagreement is reported as a change with a component's
   * name on it.
   */
  readonly stabilization?: Digest;

  /**
   * A style index already built for this document, from `indexStyleSheets`.
   *
   * Indexing walks every rule on the page; matching walks only the buckets this
   * subject's elements key into. Every subject in a session shares one document
   * and one set of sheets, so rebuilding the index per subject repeats the
   * expensive half until it is most of what a collection costs — and collecting
   * and acquiring the same subject pays for it twice. `AcquireOptions.index`
   * exists for this reason; this is the same seam on the comparison side.
   *
   * Reuse is opt-in because staleness is not detectable from here. A subject that
   * injects a stylesheet invalidates every later subject's index, and an index
   * that misses those rules prunes declarations that now apply — a false
   * `unchanged`, the failure this system exists to prevent. The holder must
   * therefore invalidate on the *content* of the sheets: a session already
   * fingerprints them on every probe, so the check is free there and no cheaper
   * signal (a sheet count, a run counter, a timestamp) is a substitute, since
   * rewriting a rule in place changes none of them.
   *
   * An index built for different conditions is refused rather than used; see
   * `StyleIndex.conditions`.
   */
  readonly index?: StyleIndex;

  /** Defaults to `chromium` when the host has a layout engine, else `jsdom`. */
  readonly profile?: ObservationProfile;

  /**
   * Subtrees the operator excluded, as `(rule id, selector)` pairs (spec 0024).
   *
   * Resolved here because running a selector needs a document and nothing above
   * this has one. What is produced is a *mark* — `RawNode.ignoredBy` — never a
   * deletion: an element removed from the capture would be absent from every
   * count downstream, and "absorbed by the `carousel` rule" and "was never
   * there" are the two states this whole mechanism exists to keep apart.
   *
   * Markup markers (`data-variance-ignore`) are honoured whether or not this is
   * supplied, because they are the operator's declaration too. Neither form
   * reaches a hash.
   */
  readonly ignore?: readonly IgnoreSelector[];
}

/**
 * The condition environment a capture of this document would be flattened
 * against.
 *
 * Exported because building a reusable index means building one for exactly the
 * conditions `collect` would have derived, and one of those inputs — the engine's
 * `@supports` probe — comes from the document's view rather than from the
 * viewport. A caller assembling a `ConditionEnvironment` by hand would omit it,
 * `collect` would refuse the index as built for a different environment, and the
 * reuse would silently never happen. Handing out the derivation is cheaper than
 * documenting it.
 */
export function conditionsFor(
  document: Document,
  viewport: Viewport,
  features?: Readonly<Record<string, string>>,
): ConditionEnvironment {
  const supports = supportsProbe(document.defaultView);

  return {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: viewport.colorScheme,
    ...(features ? { features } : {}),
    ...(supports ? { supports } : {}),
  };
}

export function collect(root: Element, options: CollectOptions): RawCapture {
  const document = root.ownerDocument;
  const view = document.defaultView;
  const profile = options.profile ?? detectProfile(view);

  const conditions = conditionsFor(document, options.viewport, options.features);

  const index = options.index
    ? sameEnvironment(options.index, conditions)
    : indexStyleSheets(document, conditions);
  const diagnostics: Diagnostic[] = [...index.diagnostics];

  if (options.fonts === undefined) {
    diagnostics.push({
      severity: 'warn',
      code: 'unverified-fonts',
      message:
        'no font content hashes supplied; the environment key cannot detect a font substitution, ' +
        'which changes metrics and therefore geometry without changing code',
    });
  }

  const ignores = resolveIgnores(
    root,
    options.ignore ? { selectors: options.ignore } : {},
  );

  for (const selector of ignores.unmatched) {
    // A warning rather than an error, and per subject rather than per run: a
    // rule scoped to a page header legitimately matches nothing in a button
    // story. What makes an unmatched selector worth reporting is the run-level
    // register finding that it matched nothing *anywhere*, and this is the
    // evidence that answer is assembled from.
    diagnostics.push({
      severity: 'warn',
      code: 'ignore-unmatched',
      message:
        `ignore rule "${selector.id}" selector \`${selector.select}\` matched nothing in this ` +
        'subject; if it matches nothing anywhere, it is a hole in the suite that absorbs nothing',
    });
  }

  const portalRoots = options.portalsOf?.(root) ?? [];
  const couplings = new Set<string>();

  if (options.portalsOf === undefined) {
    diagnostics.push({
      severity: 'warn',
      code: 'portals-not-resolved',
      message:
        'no portal provider supplied; content rendered through createPortal is outside this ' +
        'capture, and a subject that portals will report unchanged when that content changes',
    });
  }

  const capture: RawCapture = {
    captureVersion: 1,
    subject: options.subject,
    profile,
    environment: {
      profile: profile.id,
      engine: options.engine,
      viewport: options.viewport,
      fonts: options.fonts ?? [],
      // Caller-declared features *and* the conditions actually resolved while
      // flattening. The second half is what lets the semantic key drop
      // `deviceScaleFactor` safely: a resolution-gated rule that resolves
      // differently on two machines splits the key through its outcome.
      conditions: { ...options.features, ...index.evaluatedConditions },
      assets: options.assets ?? {},
      ...(options.stabilization !== undefined
        ? { stabilization: options.stabilization }
        : {}),
    },
    root: captureNode(root, profile, index, view, options, couplings, ignores.marks),
    inheritedSeed: inheritedSeed(root, profile, view, index),
    ...(couplings.size > 0 ? { couplings: [...couplings].sort() } : {}),
    ...(portalRoots.length > 0
      ? {
          portals: portalRoots.map((host) =>
            captureNode(host, profile, index, view, options, couplings, ignores.marks),
          ),
        }
      : {}),
    diagnostics,
  };

  return capture;
}

/**
 * Accept a supplied index only if it answers for the environment being captured.
 *
 * Throwing, rather than rebuilding or warning. Rebuilding would be silently
 * correct and silently slow — the caller's mistake would never surface and the
 * optimization would appear to work while doing nothing. Warning is worse: the
 * capture would still be produced, and diagnostics are outside the hash, so a
 * baseline whose `@media` blocks were resolved for another viewport would sit in
 * the store looking indistinguishable from a real one. A missing answer is
 * recoverable; a confident wrong one is not.
 */
function sameEnvironment(index: StyleIndex, conditions: ConditionEnvironment): StyleIndex {
  const wanted = conditionKey(conditions);
  if (index.conditions === wanted) return index;

  throw new Error(
    `the supplied style index was built for a different condition environment ` +
      `(index: ${index.conditions}; capture: ${wanted}). Conditional groups are erased during ` +
      `indexing, so reusing it would flatten @media and @supports against one environment while ` +
      `keying the capture to another — two different rule sets sharing one baseline. Build an ` +
      `index per environment with indexStyleSheets(document, conditionsFor(document, viewport)).`,
  );
}

function captureNode(
  element: Element,
  profile: ObservationProfile,
  index: StyleIndex,
  view: Window | null,
  options: CollectOptions,
  couplingSink: Set<string>,
  marks: ReadonlyMap<Element, readonly string[]>,
): RawNode {
  const attributes = attributesOf(element);

  const inline = (element as HTMLElement).style;
  const inlineStyle: Record<string, string> = {};
  for (const property of propertyNames(inline)) {
    inlineStyle[property] = inline.getPropertyValue(property);
  }

  const provenance = options.provenanceOf?.(element);
  const wiring = options.wiringOf?.(element);
  const ignoredBy = marks.get(element);
  const { matched, couplings } = matchRulesFor(element, index);
  for (const coupling of couplings) couplingSink.add(coupling);

  const children: RawNode[] = [];
  for (const child of childNodesOf(element)) {
    if (child.nodeType === 1) {
      children.push(captureNode(child as Element, profile, index, view, options, couplingSink, marks));
      continue;
    }

    if (child.nodeType === 3) {
      // Whitespace-only text nodes are KEPT. In an inline formatting context
      // they render as a space: `<span>a</span> <span>b</span>` reads "a b" and
      // without the node it reads "ab". Deciding which context applies needs a
      // layout engine, which the declared-only profile does not have — so the
      // node is preserved, and `core` collapses its runs to a single space.
      // Dropping it would be a false `unchanged` for a visible text change.
      children.push(textNode(child.nodeValue ?? '', provenance));
    }
  }

  const shadow = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  const shadowChildren: RawNode[] = [];
  if (shadow) {
    for (const child of elements(shadow.children)) {
      shadowChildren.push(captureNode(child, profile, index, view, options, couplingSink, marks));
    }
  }

  return {
    tag: element.tagName.toLowerCase(),
    attributes,
    aria: ariaOf(element),
    matchedRules: matched,
    ...(Object.keys(inlineStyle).length > 0 ? { inlineStyle } : {}),
    ...(profile.computedStyle && view ? { computedStyle: computedStyleOf(element, view) } : {}),
    ...(profile.layout ? { rect: rectOf(element) } : {}),
    ...(provenance ? { provenance } : {}),
    ...(wiring ? { wiring } : {}),
    children,
    ...(shadowChildren.length > 0 ? { shadowChildren } : {}),
    // Marked here and nowhere else. Only the element that matched carries the
    // rule; containment is a question about paths, which `core` answers without
    // a DOM — so a deep subtree costs one mark rather than one per node.
    ...(ignoredBy ? { ignoredBy } : {}),
  };
}

/**
 * Text is carried on a synthetic node rather than merged into its parent.
 *
 * `<p>Hello <b>world</b></p>` has two text runs whose order matters. Folding
 * them into the parent's `text` would report a reordering of prose as no change.
 *
 * It carries the parent's owner chain, because that is whose chain it is — React
 * attaches no fiber expando to a text node, but the component that rendered the
 * element rendered its text too. Without this, every text delta lands in
 * `unattributed` and cannot be grouped with the element delta that caused it,
 * which turns one root into several.
 */
function textNode(text: string, provenance: Provenance | undefined): RawNode {
  return {
    tag: '#text',
    attributes: {},
    matchedRules: [],
    text,
    ...(provenance ? { provenance } : {}),
    children: [],
  };
}

function computedStyleOf(element: Element, view: Window): Record<string, string> {
  const computed = view.getComputedStyle(element);
  const style: Record<string, string> = {};

  for (const property of propertyNames(computed)) {
    // Projection onto the allowlist happens here rather than in `core` only to
    // keep the capture small enough to cross a network hop; `core` re-applies
    // it, so this is a size optimization and never the authoritative filter.
    if (!admits(property)) continue;
    style[property] = computed.getPropertyValue(property);
  }

  return style;
}

function rectOf(element: Element): { x: number; y: number; width: number; height: number } {
  const rect = element.getBoundingClientRect();
  // Sub-pixel jitter is `texture`-band noise by definition; rounding to two
  // decimals keeps genuine half-pixel layout while discarding float drift.
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}


/**
 * Wrap `CSS.supports`, which throws on a prelude it cannot parse.
 *
 * Returns `null` for "could not decide", which the evaluator turns into
 * include-and-mark-uncertain rather than a silent exclusion.
 */
function supportsProbe(view: Window | null): ((condition: string) => boolean | null) | null {
  // `CSS` is declared as a global var rather than a `Window` member in lib.dom,
  // but it is reached through the capture's own view — which may be a JSDOM
  // window, not this realm's global.
  const css = (view as (Window & { CSS?: { supports?(condition: string): boolean } }) | null)?.CSS;
  if (!css || typeof css.supports !== 'function') return null;

  return (condition: string): boolean | null => {
    try {
      return css.supports!(condition);
    } catch {
      return null;
    }
  };
}

