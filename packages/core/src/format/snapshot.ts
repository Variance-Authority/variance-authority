import type { SubjectRef, Rect, Diagnostic } from './capture.js';
import type { EnvironmentKey } from './environment.js';
import type { Digest } from './hash.js';
import type { ObservationProfile } from './profile.js';
import type { Provenance } from './provenance.js';

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
   * `true` on the root of a subtree rendered through a portal.
   *
   * Recorded in the structure hash so that "the dialog moved from inline to
   * portalled" is a change rather than a coincidence of identical content, and
   * so the docket can say *where* something rendered, not only that it exists.
   */
  readonly portalled?: boolean;

  readonly children: readonly SemanticNode[];
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
