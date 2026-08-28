import type { EnvironmentInputs } from './environment.js';
import type { ObservationProfile } from './profile.js';
import type { Provenance } from './provenance.js';
import type { Wiring } from './wiring.js';
import type { Holding } from './holding.js';

/**
 * The collector/core boundary.
 *
 * Collectors **extract**; `core` **normalizes**. Nothing in this file is a live
 * object — a `RawCapture` is plain data, fully serializable, produced by touching
 * a DOM and consumed by code that has never seen one.
 *
 * Two properties fall out of that split, and both are the reason for it:
 *
 * 1. **One ruleset, by construction.** Normalization is the moat (ADR-0003) and
 *    the thing most likely to drift between two implementations. If the JSDOM and
 *    Chromium collectors each normalized their own captures, "the same rules ran"
 *    would be a claim maintained by discipline. Here it is a fact of the call
 *    graph: there is one normalizer and both profiles enter it.
 * 2. **The sub-renderer can be anywhere.** A capture crossing a worker boundary,
 *    a pipe, or a network hop to a device farm is the same value it was in
 *    process. No code may assume the collector is local.
 */
export interface RawCapture {
  readonly captureVersion: 1;
  readonly subject: SubjectRef;
  readonly profile: ObservationProfile;

  /**
   * Environment inputs the *collector* is positioned to know — engine version,
   * fonts actually loaded, resolved conditions, asset hashes. The ruleset and
   * allowlist versions are `core`'s to supply, so they are absent here and the
   * key is completed during normalization.
   */
  readonly environment: Omit<EnvironmentInputs, 'ruleset' | 'allowlist'>;

  readonly root: RawNode;

  /**
   * Inherited values in force at the subject root.
   *
   * Mandatory, not an optimization. CSS applicability pruning (ADR-0003) drops
   * every rule that matches nothing inside the subtree — including rules on
   * ancestors *outside* it whose inheritable properties still reach in. Without
   * this seed the cheap tier is unsound and will report false `unchanged`.
   */
  readonly inheritedSeed: Readonly<Record<string, string>>;

  /**
   * Subtrees this subject renders through portals, in fiber traversal order.
   *
   * A subject's boundary is a component-tree question, not a DOM-containment
   * one: `createPortal` renders elsewhere in the document while remaining part
   * of the tree rooted here. Omitting these makes an opening modal report
   * `unchanged`, because its own container is byte-identical (ADR-0007).
   */
  readonly portals?: readonly RawNode[];

  /**
   * Shared root state this subject is *latently* coupled to.
   *
   * Rules like `html.dark .card` contribute nothing today and everything the
   * moment `dark` lands on `<html>`. In a session that reuses one document across
   * subjects, that moment may arrive because a *different* subject put it there —
   * turning this subject's baseline order-dependent with no visible cause.
   * Recorded so the coupling can be reported before it bites.
   */
  readonly couplings?: readonly string[];

  /** Anything the collector could not do. Empty is the expected case. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface SubjectRef {
  /** Stable across renames of the file, e.g. `story:components-button--primary`. */
  readonly id: string;

  /**
   * What kind of thing this is, which is not the same question as what produced
   * it.
   *
   * `value` is the one that is not a rendering: a JSON body, a schema, a route
   * table. It is a fourth member rather than a reuse of `route`, which already
   * means *a page rendered at a URL* — a route table is a value about the same
   * paths, and a subject list where one word meant both is one nobody can filter.
   */
  readonly kind: 'story' | 'route' | 'fixture' | 'value';
  readonly title?: string;
}

/**
 * A node exactly as observed, before any rule is applied.
 *
 * Raw means raw: `attributes` still holds generated ids and hashed class names,
 * `matchedRules` still holds cascade losers. Normalization needs the unedited
 * input — a collector that helpfully pre-cleaned would be a second, invisible
 * ruleset, versioned by nothing.
 */
export interface RawNode {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;

  /** Resolved accessibility properties, when the profile provides them. */
  readonly aria?: RawAria;

  /**
   * Rules matching this node, as authored.
   *
   * Losing declarations are retained: `core` resolves the cascade for profiles
   * whose engine did not (ADR-0003 step 5), and cannot do that from winners
   * alone. Shorthands are retained *unexpanded* — expansion is `core`'s job, so
   * that it is versioned by the ruleset rather than by each collector.
   *
   * A collector MAY drop a declaration whose property is neither allowlisted nor
   * a shorthand of an allowlisted property, and SHOULD when the capture crosses
   * a network hop. It MUST NOT normalize values; a helpfully pre-cleaned capture
   * is a second, invisible ruleset versioned by nothing.
   */
  readonly matchedRules: readonly MatchedRule[];

  readonly inlineStyle?: Readonly<Record<string, string>>;

  /** Engine-resolved computed style. Present only when `profile.computedStyle`. */
  readonly computedStyle?: Readonly<Record<string, string>>;

  /** Present only when `profile.layout`. */
  readonly rect?: Rect;

  /** Literal text of a text node. Digested during normalization, per policy. */
  readonly text?: string;

  readonly provenance?: Provenance;

  /**
   * How the framework holds this node's component, when an adapter supplied it.
   *
   * Beside `provenance` because it arrives from the same seam and under the same
   * rule: the collector carries no framework dependency and both are injected.
   * See {@link Wiring} for why it is a dimension rather than another attribution
   * field.
   */
  readonly wiring?: Wiring;

  /**
   * What the component that authored this node was holding, when an adapter
   * supplied it.
   *
   * A third injection at the same seam, and deliberately not folded into
   * `wiring`: wiring is hashed into a band and this may never be, so a caller
   * that wants the band must be able to have it without also carrying values,
   * and a caller that wants explanations must be able to ask for them without
   * changing a single digest. See {@link Holding}.
   */
  readonly holding?: Holding;

  readonly children: readonly RawNode[];

  /** Nodes inside a shadow root, kept distinct from light-DOM children. */
  readonly shadowChildren?: readonly RawNode[];

  /**
   * Ignore rules the collector found this element under (spec 0024).
   *
   * A mark, not a removal. The collector is the only thing holding a live DOM, so
   * it is the only thing that can run a selector or read a marker attribute — but
   * it must not act on what it finds. An element deleted from the capture would
   * be invisible to every count downstream, and the difference between "absorbed
   * by the `carousel` rule" and "was never there" is the difference between an
   * ignore and a blind spot.
   *
   * Never hashed. Normalization turns these into
   * {@link import('./snapshot.js').SemanticSnapshot.ignoreSites}, which sits
   * beside `styleProvenance` outside the render hash for the same reason: masking
   * a clock changes what a run *says*, not what it *renders*, and must not
   * re-baseline the repository.
   */
  readonly ignoredBy?: readonly string[];
}

export interface RawAria {
  readonly role: string | null;
  readonly name: string | null;

  /**
   * Accessible description — what `aria-describedby` and `title` resolve to.
   *
   * Captured because nothing else captures it, and its absence was a hole. The
   * attribute allowlist drops every `aria-*` attribute on the stated grounds
   * that they "are resolved into role/name/state" — true of `aria-label` and
   * `aria-selected`, and false of `aria-describedby`, which resolves into a
   * description and had nowhere to land. A field whose `aria-describedby`
   * pointed at a deleted error message compared **equal**: the reference was
   * dropped by the allowlist, the name was unaffected, and the regression was
   * silent on every tier including raster.
   */
  readonly description?: string | null;

  /** `checked`, `disabled`, `expanded`, `selected`, … */
  readonly state: Readonly<Record<string, string | boolean | number>>;
}

export interface MatchedRule {
  /** Identifies the origin sheet for attribution: href, or a synthetic id. */
  readonly sheet: string;
  readonly selector: string;
  /** `[idCount, classCount, typeCount]` — CSS specificity, most significant first. */
  readonly specificity: readonly [number, number, number];
  /** Document order of the rule. Breaks specificity ties, per the cascade. */
  readonly order: number;
  readonly declarations: readonly Declaration[];
  /** Source position, when the sheet exposes one. Turns a diff into a file:line. */
  readonly source?: { readonly file: string; readonly line: number };
}

export interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  /** Custom properties referenced by the value, for token-keyed attribution. */
  readonly references?: readonly string[];
}

/** Browser-layout coordinates retained as evidence, without a preferred layout policy. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Diagnostic {
  readonly severity: 'warn' | 'error';
  readonly code: string;
  readonly message: string;
  readonly nodePath?: string;
}
