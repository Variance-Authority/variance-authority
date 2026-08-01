import {
  CHROMIUM_PROFILE,
  JSDOM_PROFILE,
  admits,
  type Diagnostic,
  type ObservationProfile,
  type Provenance,
  type RawCapture,
  type RawNode,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core';
import { ariaOf } from './aria.js';
import { indexStyleSheets, matchRulesFor, type StyleIndex } from './css.js';
import type { ConditionEnvironment } from './media.js';
import { attributesOf, childNodesOf, elements, propertyNames } from './dom-list.js';

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
   * `@variance-authority/provenance-react`.
   *
   * Injected rather than imported so the collector carries no framework
   * dependency — the same seam other frameworks arrive through later (spec §9).
   */
  readonly provenanceOf?: (element: Element) => Provenance | undefined;

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
   * from `@variance-authority/provenance-react`.
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

  /** Defaults to `chromium` when the host has a layout engine, else `jsdom`. */
  readonly profile?: ObservationProfile;
}

export function collect(root: Element, options: CollectOptions): RawCapture {
  const document = root.ownerDocument;
  const view = document.defaultView;
  const profile = options.profile ?? detectProfile(view);

  const conditions: ConditionEnvironment = {
    width: options.viewport.width,
    height: options.viewport.height,
    deviceScaleFactor: options.viewport.deviceScaleFactor,
    colorScheme: options.viewport.colorScheme,
    ...(options.features ? { features: options.features } : {}),
    ...(supportsProbe(view) ? { supports: supportsProbe(view)! } : {}),
  };

  const index = indexStyleSheets(document, conditions);
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

  const portalRoots = options.portalsOf?.(root) ?? [];

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
      conditions: { ...(options.features ?? {}) },
      assets: options.assets ?? {},
    },
    root: captureNode(root, profile, index, view, options),
    inheritedSeed: inheritedSeed(root, profile, view),
    ...(portalRoots.length > 0
      ? { portals: portalRoots.map((host) => captureNode(host, profile, index, view, options)) }
      : {}),
    diagnostics,
  };

  return capture;
}

function captureNode(
  element: Element,
  profile: ObservationProfile,
  index: StyleIndex,
  view: Window | null,
  options: CollectOptions,
): RawNode {
  const attributes = attributesOf(element);

  const inline = (element as HTMLElement).style;
  const inlineStyle: Record<string, string> = {};
  for (const property of propertyNames(inline)) {
    inlineStyle[property] = inline.getPropertyValue(property);
  }

  const provenance = options.provenanceOf?.(element);

  const children: RawNode[] = [];
  for (const child of childNodesOf(element)) {
    if (child.nodeType === 1) {
      children.push(captureNode(child as Element, profile, index, view, options));
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
      shadowChildren.push(captureNode(child, profile, index, view, options));
    }
  }

  return {
    tag: element.tagName.toLowerCase(),
    attributes,
    aria: ariaOf(element),
    matchedRules: matchRulesFor(element, index),
    ...(Object.keys(inlineStyle).length > 0 ? { inlineStyle } : {}),
    ...(profile.computedStyle && view ? { computedStyle: computedStyleOf(element, view) } : {}),
    ...(profile.layout ? { rect: rectOf(element) } : {}),
    ...(provenance ? { provenance } : {}),
    children,
    ...(shadowChildren.length > 0 ? { shadowChildren } : {}),
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
 * Inherited values in force at the subject root.
 *
 * Mandatory, not an optimization (ADR-0003). Applicability pruning drops every
 * rule matching nothing inside the subtree — including rules on ancestors
 * *outside* it whose inheritable properties still reach in. Without this seed
 * the cheap tier reports false `unchanged`.
 *
 * Under a profile without computed style there is no way to read the ancestors'
 * resolved values, so the seed is empty and the tier is correspondingly weaker.
 * That is reported by the profile, not papered over here.
 */
function inheritedSeed(
  root: Element,
  profile: ObservationProfile,
  view: Window | null,
): Record<string, string> {
  if (!profile.computedStyle || !view || !root.parentElement) return {};

  const parent = view.getComputedStyle(root.parentElement);
  const seed: Record<string, string> = {};

  for (const property of INHERITABLE) {
    const value = parent.getPropertyValue(property);
    if (value) seed[property] = value;
  }

  for (const property of propertyNames(parent)) {
    if (property.startsWith('--')) seed[property] = parent.getPropertyValue(property);
  }

  return seed;
}

const INHERITABLE: readonly string[] = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'font-stretch', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-indent', 'text-transform', 'white-space', 'word-break',
  'overflow-wrap', 'visibility', 'direction', 'writing-mode',
  'caption-side', 'border-collapse', 'border-spacing',
];

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

/**
 * Decide the profile from what the host can actually do.
 *
 * JSDOM reports zeros from `getBoundingClientRect` because it has no layout
 * engine. Probing for that is more honest than sniffing for a JSDOM global: the
 * question the profile answers is "can this host observe geometry", and the way
 * to know is to ask it.
 */
function detectProfile(view: Window | null): ObservationProfile {
  if (!view) return JSDOM_PROFILE;

  const probe = view.document.createElement('div');
  probe.style.cssText = 'position:absolute;width:100px;height:100px;';
  view.document.body?.appendChild(probe);
  const measured = probe.getBoundingClientRect().width;
  probe.remove();

  return measured > 0 ? CHROMIUM_PROFILE : JSDOM_PROFILE;
}
