import {
  type ContractBand,
  type InterfaceDocument,
  type InterfaceField,
  type InterfaceOperation,
  type Position,
  loudestContractBand,
  positionsOf,
} from './document.js';

/**
 * Two interfaces become deltas — and no verdict (spec 0031).
 *
 * `compare/` does this for two rendered documents. This is the same shape one
 * medium over, and it exists because the medium answers a question the other
 * cannot: a schema knows a **position**, and position is what decides who
 * breaks.
 *
 * Adding a member to an enum is safe in a request and breaking in a response.
 * Making a field nullable is safe in a request and breaking in a response.
 * Making a field required is breaking in a request and safe in a response. Each
 * pair is the same edit to the same line, so a text diff has one move available:
 * show a person everything. {@link bandOfChange} is the whole difference, and it
 * is one switch.
 *
 * Two assumptions are stated rather than implied. The repository **publishes**
 * this interface, so *breaking* means breaking somebody else's caller. And a
 * widened output breaks a caller that handles its values exhaustively, which is
 * the common case in a typed client and not a universal one — the widening is
 * reported, and the clients are never counted.
 */

export type ContractChange =
  | 'required-field-added'
  | 'optional-field-added'
  | 'field-removed'
  | 'enum-member-added'
  | 'enum-member-removed'
  | 'made-required'
  | 'made-optional'
  | 'made-nullable'
  | 'made-non-nullable'
  | 'type-changed'
  | 'member-reordered';

/**
 * Where a delta was found.
 *
 * A named type when one owns the change, because a `Money` under four operations
 * is one finding and not four. An operation's own field only when nothing named
 * declares it.
 */
export type ContractSite =
  | { readonly kind: 'type'; readonly type: string; readonly member: string }
  | { readonly kind: 'field'; readonly operation: string; readonly path: string };

export interface ContractDelta {
  readonly change: ContractChange;
  readonly at: ContractSite;

  /**
   * Every position that reaches the site. Never empty.
   *
   * A type reached from both sides is the common case, not the corner: a GraphQL
   * enum is shared between argument and field position by construction, and an
   * OpenAPI component under one request body and three responses is what `$ref`
   * is for. A change to one is one delta naming both positions, banded by the
   * loudest — a caller only has to break on one side to break.
   */
  readonly positions: readonly Position[];

  readonly band: ContractBand;
}

/**
 * The band table, as one exhaustive switch per position.
 *
 * This function is the thesis. Every row is qualified by position, because an
 * unqualified row is wrong half the time.
 */
export function bandOfChange(change: ContractChange, position: Position): ContractBand {
  if (change === 'member-reordered') return 'annotation';

  // A field whose declared type was replaced cannot be classified without
  // comparing the two types, which is a different question asked of a different
  // pair. Unclassified is reported at the loudest band rather than guessed at
  // the quietest: the failure of a wrong guess here is a silent one.
  if (change === 'type-changed') return 'contract';

  // The callee accepts strictly more, or strictly less. Less is what breaks.
  if (position === 'request') {
    switch (change) {
      case 'required-field-added':
      case 'field-removed':
      case 'enum-member-removed':
      case 'made-required':
      case 'made-non-nullable':
        return 'contract';
      case 'optional-field-added':
      case 'enum-member-added':
      case 'made-optional':
      case 'made-nullable':
        return 'capability';
    }
  }

  // The callee returns strictly more, or strictly less. More breaks a caller
  // reading exhaustively; less breaks every caller that read it.
  switch (change) {
    case 'field-removed':
    case 'enum-member-added':
    case 'made-optional':
    case 'made-nullable':
      return 'contract';
    case 'required-field-added':
    case 'optional-field-added':
    case 'enum-member-removed':
    case 'made-required':
    case 'made-non-nullable':
      return 'capability';
  }
}

/** The last segment of a field path. `total.amount` is declared as `amount`. */
function leafOf(path: string): string {
  const cut = path.lastIndexOf('.');
  return cut === -1 ? path : path.slice(cut + 1);
}

interface Placed {
  readonly field: InterfaceField;
  readonly operation: string;
  readonly position: Position;
}

function fieldsOf(document: InterfaceDocument): Map<string, Placed> {
  const placed = new Map<string, Placed>();

  const put = (operation: InterfaceOperation, position: Position): void => {
    for (const field of position === 'request' ? operation.request : operation.response) {
      placed.set(`${operation.id} ${position} ${field.path}`, {
        field,
        operation: operation.id,
        position,
      });
    }
  };

  for (const operation of document.operations) {
    put(operation, 'request');
    put(operation, 'response');
  }
  return placed;
}

/** What one field-level difference is, before it is placed or banded. */
function changesBetween(before: InterfaceField, after: InterfaceField): readonly ContractChange[] {
  const changes: ContractChange[] = [];

  if (before.type !== after.type) changes.push('type-changed');
  if (before.required !== after.required) {
    changes.push(after.required ? 'made-required' : 'made-optional');
  }
  if (before.nullable !== after.nullable) {
    changes.push(after.nullable ? 'made-nullable' : 'made-non-nullable');
  }
  return changes;
}

/** A delta before its positions are merged: the site it lands on, and where it was seen. */
interface Pending {
  readonly change: ContractChange;
  readonly at: ContractSite;
  readonly position: Position;
}

function siteKey(site: ContractSite): string {
  return site.kind === 'type'
    ? `type ${site.type} ${site.member}`
    : `field ${site.operation} ${site.path}`;
}

/**
 * Every difference between two interfaces, one delta per site.
 *
 * Object members are read from the operations rather than from `types`, because
 * that is where requiredness lives — and *optional input added* against
 * *required input added* is the widest gap in the table. Enum and union members
 * are read from `types`, because no operation carries them.
 */
export function compareInterfaces(
  baseline: InterfaceDocument,
  candidate: InterfaceDocument,
): readonly ContractDelta[] {
  const pending: Pending[] = [];

  const before = fieldsOf(baseline);
  const after = fieldsOf(candidate);

  // An owned field lands on the type that declares it; an unowned one lands on
  // the operation. This is what turns forty reached operations into one finding.
  const place = (placed: Placed, change: ContractChange): void => {
    const owner = placed.field.owner;
    pending.push({
      change,
      at:
        owner === undefined
          ? { kind: 'field', operation: placed.operation, path: placed.field.path }
          : { kind: 'type', type: owner, member: leafOf(placed.field.path) },
      position: placed.position,
    });
  };

  for (const [key, placed] of before) {
    const now = after.get(key);
    if (now === undefined) {
      place(placed, 'field-removed');
      continue;
    }
    for (const change of changesBetween(placed.field, now.field)) place(now, change);
  }

  for (const [key, placed] of after) {
    if (before.has(key)) continue;
    place(placed, placed.field.required ? 'required-field-added' : 'optional-field-added');
  }

  for (const [name, was] of Object.entries(baseline.types)) {
    const now = candidate.types[name];
    if (now === undefined || (was.shape !== 'enum' && was.shape !== 'union')) continue;

    const held = new Set(was.members);
    const has = new Set(now.members);

    // A type nothing reaches cannot break a caller. Both documents are asked,
    // because a type that lost a position in the same revision must not also
    // lose the loudest reading of what happened to it.
    const positions = new Set([...positionsOf(baseline, name), ...positionsOf(candidate, name)]);
    if (positions.size === 0) continue;

    const record = (change: ContractChange, member: string): void => {
      for (const position of positions) {
        pending.push({ change, at: { kind: 'type', type: name, member }, position });
      }
    };

    for (const member of was.members) if (!has.has(member)) record('enum-member-removed', member);
    for (const member of now.members) if (!held.has(member)) record('enum-member-added', member);

    const sameSet = held.size === has.size && was.members.every((member) => has.has(member));
    const sameOrder = was.members.every((member, index) => now.members[index] === member);
    if (sameSet && !sameOrder) record('member-reordered', '');
  }

  const merged = new Map<string, { readonly entry: Pending; readonly positions: Set<Position> }>();
  for (const entry of pending) {
    const key = `${entry.change} ${siteKey(entry.at)}`;
    const held = merged.get(key);
    if (held === undefined) {
      merged.set(key, { entry, positions: new Set([entry.position]) });
      continue;
    }
    held.positions.add(entry.position);
  }

  const deltas = [...merged.values()].map(({ entry, positions }) => {
    const ordered = (['request', 'response'] as const).filter((position) => positions.has(position));
    const band = loudestContractBand(ordered.map((position) => bandOfChange(entry.change, position)));

    // `ordered` is non-empty by construction, so the band is never null. Stated
    // as a refusal rather than an assertion: a silent `annotation` here would be
    // a breaking change reported as a spelling correction.
    if (band === null) throw new Error(`contract delta at ${siteKey(entry.at)} reached no position`);

    return { change: entry.change, at: entry.at, positions: ordered, band };
  });

  // Code-unit ordering. Never `localeCompare`: this ordering reaches a report.
  return deltas.sort((left, right) => {
    const here = siteKey(left.at);
    const there = siteKey(right.at);
    if (here !== there) return here < there ? -1 : 1;
    if (left.change === right.change) return 0;
    return left.change < right.change ? -1 : 1;
  });
}
