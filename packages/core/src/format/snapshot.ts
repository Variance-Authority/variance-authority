import type { SubjectRef, Rect, Diagnostic } from './capture.js';
import type { EnvironmentKey } from './environment.js';
import type { Digest } from './hash.js';
import type { ObservationProfile } from './profile.js';
import type { Provenance } from './provenance.js';
import type { Wiring } from './wiring.js';
import type { Holding } from './holding.js';

/**
 * The normalized semantic snapshot: the verdict's input, and the thing a render
 * hash addresses.
 *
 * Everything volatile is gone by this point. Ids have become structural aliases,
 * class attributes have been dropped entirely, inapplicable CSS has been pruned,
 * and the cascade has been resolved to winning values (ADR-0003). What remains is
 * meant to be *read*: a snapshot a reviewer refuses to open is a snapshot that
 * gets rubber-stamped.
 */
export interface SemanticSnapshot {
  readonly formatVersion: 1;
  readonly subject: SubjectRef;
  readonly profile: ObservationProfile;
  readonly environment: EnvironmentKey;

  /** Content hash of `root` under `environment`. The identity of this state. */
  readonly renderHash: Digest;

  /**
   * Structure and applicable style, hashed separately.
   *
   * These back the tier below full semantic comparison (ADR-0003): matching both
   * settles a subject without resolving layout or taking a screenshot. Split
   * rather than combined because the docket wants to say *which* held — "the DOM
   * is identical, only styling moved" is the sentence that turns a diff into a
   * token-band root.
   */
  readonly structureHash: Digest;
  readonly styleHash: Digest;

  readonly root: SemanticNode;

  /**
   * Where each winning declaration came from. Deliberately outside the hash.
   *
   * Pruning discards exactly what attribution needs — *which rule set this?* — so
   * it is preserved here instead. Keeping it out of the hash is the point: moving
   * a rule between files renames a source without changing a render, and must not
   * invalidate a baseline.
   */
  readonly styleProvenance: readonly StyleProvenanceEntry[];

  /**
   * Subtrees the operator declared out of scope, resolved against *this* tree.
   *
   * Deliberately outside the hash, for the reason `styleProvenance` is: an ignore
   * changes what a run says about a render, never the render. Folding it into the
   * identity would invalidate every baseline in the repository the first time
   * somebody masked a clock, which is the surest way to make a safety feature the
   * thing people turn off.
   *
   * Present only when something was excluded, so a snapshot from a run with no
   * ignores is byte-identical to one produced before this field existed.
   */
  readonly ignoreSites?: readonly IgnoreSite[];

  /**
   * What the collector or the normalizer could not do, carried forward.
   *
   * Outside the hash: a diagnostic describes the *observation*, not the render,
   * and a snapshot that hashed its own warnings would invalidate whenever the
   * warning text was reworded. But it must survive to the verdict — a subject
   * whose capture half-failed is not a subject that legitimately `unchanged`,
   * and silently discarding that fact is how a broken collector reads as a clean
   * build.
   */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * A node's stable address: child indices from the root, e.g. `0/2/1`.
 *
 * Positional because nothing else survives. Ids are volatile (that is why they
 * were aliased away), and class names have been dropped. Position is honest about
 * what it costs: inserting a sibling renumbers everything after it, so the differ
 * matches nodes by shape and provenance before falling back to path (see
 * `diff.ts`), and treats a path change alone as evidence of nothing.
 */
export type NodePath = string;

export interface SemanticNode {
  readonly path: NodePath;
  readonly tag: string;

  /** Structural alias, e.g. `#a0`. Absent when the node carried no id. */
  readonly alias?: string;

  readonly role?: string;
  readonly name?: string;

  /**
   * Accessible description, resolved. See `RawAria.description` for why this is
   * a field of its own rather than an attribute.
   */
  readonly description?: string;

  readonly state?: Readonly<Record<string, string | boolean | number>>;

  /** Semantic attributes surviving normalization. `class` is never among them. */
  readonly attributes: Readonly<Record<string, string>>;

  /** Winning values for allowlisted properties, canonicalized. */
  readonly style: Readonly<Record<string, string>>;

  /**
   * Custom properties this node's winning declarations resolved through, as
   * name → resolved value.
   *
   * Recording the name alongside the value is what lets a design-token change
   * surface as one root with counted collateral instead of hundreds of unrelated
   * colour diffs (spec §5, `token` band).
   */
  readonly tokens?: Readonly<Record<string, string>>;

  /**
   * Which token each styled property resolved through, including by inheritance.
   *
   * Outside the hash, like `styleProvenance` and for the same reason: swapping a
   * literal for a token of the same value renames a source without changing a
   * render. It exists so the differ can tell *which* property a token edit
   * explains — `tokens` alone says a node uses tokens, not which of its values
   * one drove.
   */
  readonly styleTokens?: Readonly<Record<string, string>>;

  /** Present only under a profile with layout. Absent, never zeroed (ADR-0002). */
  readonly rect?: Rect;

  /** Text content, or its digest when policy declares the region volatile. */
  readonly text?: string;

  readonly provenance?: Provenance;

  /**
   * How the framework holds this node's component, when a framework adapter
   * supplied it. See {@link Wiring}.
   *
   * On the node rather than on `Provenance`, though both come from the same
   * adapter and the same fiber, because they answer to different readers.
   * Provenance exists so a diff arrives carrying a name; wiring is a *dimension
   * of the subject*, hashed into a band of its own, and a band's inputs belong
   * beside the other bands' inputs — next to `style` and `attributes`, which is
   * where `shapeOf` goes looking.
   */
  readonly wiring?: Wiring;

  /**
   * What that component was holding. **Outside every hash**, always.
   *
   * The field beside it is the contrast worth reading: `wiring` is a band and
   * this is evidence. `Wiring` refuses state values because a hook's value is
   * exactly what may legitimately differ between two readings of one page, and
   * that refusal is right and is not softened here — a `holding` reaches the
   * snapshot and reaches no digest, so a subject whose clock ticked has the same
   * `renderHash` it had before this field existed.
   *
   * It rides outside on the same terms as `styleProvenance`, `styleTokens` and
   * `ignoredBy`, by the same mechanism: `structureOf`, `styleOf` and `shapeOf`
   * project the fields they hash **by name**, so a field none of them names
   * cannot reach an identity. `holding.hash.test.ts` asserts that rather than
   * trusting it, because the cost of being wrong is every baseline in a
   * repository invalidating the first time a component held a timestamp.
   */
  readonly holding?: Holding;

  /**
   * `true` on the root of a subtree rendered through a portal.
   *
   * Recorded in the structure hash so that "the dialog moved from inline to
   * portalled" is a change rather than a coincidence of identical content, and
   * so the docket can say *where* something rendered, not only that it exists.
   */
  readonly portalled?: boolean;

  /**
   * Ignore rules this node was found under. Outside every hash, like its origin
   * on `RawNode`. See {@link SemanticSnapshot.ignoreSites}.
   */
  readonly ignoredBy?: readonly string[];

  readonly children: readonly SemanticNode[];
}

/**
 * A subtree the operator excluded, resolved to a path and a box (spec 0024).
 *
 * Lives in `format` rather than beside the rules that consume it, because it is
 * part of what a snapshot *is*: the collector produced it, it travels with the
 * document over every wire this project has, and `core/judge` is only its first
 * reader. A type the wire format needs cannot live in the policy layer.
 */
export interface IgnoreSite {
  /** Root of the excluded subtree, in this snapshot's own path space. */
  readonly path: NodePath;

  /** Which rule put it here, matched exactly against `IgnoreRule.id`. */
  readonly rule: string;

  /**
   * The box it occupied, for the raster tier.
   *
   * Absent under a profile with no layout — which is ADR-0002 rather than a
   * failure: a profile that cannot measure a box cannot decide pixels either, so
   * there is nothing for the box to subtract from.
   */
  readonly rect?: Rect;
}

/**
 * A component's own content, hashed per band (ADR-0018).
 *
 * In `format` rather than beside `hashComponents`, which computes it, because a
 * baseline carries these: a stored image plus the component hashes of the
 * document that painted it is what lets a later run tell the component that
 * *caused* a change from the components the change merely moved. That makes this
 * part of the wire format every store and every transport has to preserve, and a
 * type the wire needs cannot live in the layer that derives it.
 */
export interface ComponentHash {
  readonly component: string;

  /** Boundaries of this component in the subject, counted in document order. */
  readonly instances: number;

  /**
   * Tree shape: tags, structural aliases, portalling, allowlisted attributes,
   * and which child boundaries sit where. The `geometry` band's structural half.
   *
   * **Split out of a single `structure` digest on 2026-08-06.** It used to carry
   * the accessible semantics and the text too, and the fusion was invisible
   * until something needed to ask *which band moved* — at which point a baseline
   * could say "this component changed" and never say whether a heading was
   * renamed, a paragraph reworded, or a node inserted. Those are three different
   * bands, three different readers, and one of them is the band a route-level
   * test exists to ignore.
   */
  readonly structure: Digest;

  /**
   * Role, accessible name, and ARIA state. The `a11y` band.
   *
   * Its own digest because it is the band that must never be absorbed. Every
   * sensitivity level asserts on it, including the ones that ignore everything
   * else — and a level cannot assert on a band that is fused into another one.
   */
  readonly semantics: Digest;

  /** Text runs, in document order. The `content` band. */
  readonly text: Digest;

  readonly style: Digest;

  /**
   * Absent under a profile without layout — absent, never empty (ADR-0002).
   *
   * An empty geometry digest would compare equal between a run that observed no
   * movement and a run that could not observe movement at all, which is the
   * false `unchanged` this system must never produce.
   */
  readonly geometry?: Digest;
}

export interface StyleProvenanceEntry {
  readonly path: NodePath;
  readonly property: string;
  readonly sheet: string;
  /** Generated segments replaced by placeholders, so it can name a root safely. */
  readonly selector: string;
  readonly tokenName?: string;
  readonly source?: { readonly file: string; readonly line: number };
}
