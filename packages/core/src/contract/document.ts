import type { Digest } from '../format/hash.js';

/**
 * A public interface as a comparable value (spec 0031).
 *
 * The document a dialect reader produces, and the only thing the comparison
 * knows about. No parser lives here and none may: `core` carries no third-party
 * dependency, and every dialect worth reading arrives through somebody else's.
 *
 * ## Why the operations carry flattened fields
 *
 * The one question this format exists to answer is *from which positions is this
 * type reached* — because that, and nothing in the text of a diff, decides
 * whether an edit breaks a caller. A nested tree would make that a transitive
 * walk with cycles to condense; a flat list of full paths makes it a scan.
 *
 * So `total.amount` is a field **of the operation**, named by its whole path,
 * and {@link InterfaceField.owner} records the named type that declared it. The
 * tree is not lost, it is indexed by the question being asked of it.
 */

/** Which side of a call a field sits on. The whole spec turns on this word. */
export type Position = 'request' | 'response';

/**
 * How loudly a contract delta is reported, on the same axis as `Band`.
 *
 * Local to this module rather than a member of `core`'s `Band` while there is
 * one caller. Joining that union is a decision with three costs — an ordering
 * across two families, a forced `observableBands` answer per profile, and
 * absorption by sensitivity levels written for rendered subjects — and none of
 * them can be priced by a module nothing else imports yet.
 */
export type ContractBand =
  /** A caller that worked stops working. Rare, and fatal. */
  | 'contract'
  /**
   * No caller breaks, and the published interface moved.
   *
   * Growth is the usual reason — a new operation, a new optional input — but a
   * narrowed *output* lands here too: nobody breaks, and nobody may auto-pass a
   * promise being withdrawn either.
   */
  | 'capability'
  /** Descriptions, examples, member order. Auto-passes; counted, never reviewed. */
  | 'annotation';

/** Loudest first. `loudestContractBand` reads this order; nothing else may. */
export const CONTRACT_BANDS: readonly ContractBand[] = ['contract', 'capability', 'annotation'];

/**
 * The loudest band present, or `null` for an empty set.
 *
 * `null` rather than a default, for `loudestBand`'s reason: nothing changed and
 * something changed quietly are different states.
 */
export function loudestContractBand(bands: Iterable<ContractBand>): ContractBand | null {
  const present = new Set(bands);
  return CONTRACT_BANDS.find((band) => present.has(band)) ?? null;
}

/** One field of one operation, at its full path. */
export interface InterfaceField {
  /** Full path within the operation's payload, e.g. `total.amount`. */
  readonly path: string;

  /** The name of the type this field carries. A key into {@link InterfaceDocument.types}. */
  readonly type: string;

  /**
   * The named type that declares this field, when one does.
   *
   * The root a finding lands on. A `Money` under four operations produces one
   * finding naming `Money`, not four naming operations — which is the whole
   * difference between this and forty red rectangles.
   */
  readonly owner?: string;

  readonly required: boolean;
  readonly nullable: boolean;
}

export interface InterfaceOperation {
  readonly id: string;
  /** Flattened: every field the request accepts, at its full path. */
  readonly request: readonly InterfaceField[];
  /** Flattened: every field the response promises, at its full path. */
  readonly response: readonly InterfaceField[];
}

export interface InterfaceType {
  readonly shape: 'object' | 'enum' | 'union' | 'scalar' | 'list';

  /**
   * Member names, in the order the interface declares them.
   *
   * Fields for an object, values for an enum, arms for a union. Order is kept
   * because some clients index into it; it is reported at `annotation` rather
   * than normalized away, which would be a fact deleted rather than ranked.
   */
  readonly members: readonly string[];

  readonly digest: Digest;
}

export interface InterfaceDocument {
  /** `openapi`, `graphql`, `route-table`, or `value` for the untyped case. */
  readonly dialect: string;

  /** What emitted it. The environment key for this material, when there is one. */
  readonly generator?: { readonly name: string; readonly version: string };

  readonly operations: readonly InterfaceOperation[];

  /** Named types, once each. Operations reference them; they hold no operations. */
  readonly types: Readonly<Record<string, InterfaceType>>;

  /**
   * Names the reader could not resolve.
   *
   * Absent is not empty (ADR-0002). An unresolved reference read as a type with
   * no members is a removal of everything it declared, reported against nobody.
   */
  readonly unread?: readonly string[];
}

/**
 * Every position from which some operation reaches this type.
 *
 * The empty set is a real answer: a type nothing references cannot break a
 * caller, and a delta against it is not reported at all.
 */
export function positionsOf(document: InterfaceDocument, type: string): ReadonlySet<Position> {
  const found = new Set<Position>();

  for (const operation of document.operations) {
    if (operation.request.some((field) => field.type === type)) found.add('request');
    if (operation.response.some((field) => field.type === type)) found.add('response');
  }
  return found;
}
