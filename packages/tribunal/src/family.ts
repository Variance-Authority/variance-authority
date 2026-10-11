/**
 * A subject's family: the component it is a story of, read off its id.
 *
 * Apart from the journeys panel, which cut its pool this way first, because the
 * server reads families too: what the docket groups by must be what the pages
 * draw, and one cut written twice is two answers to *which component is this*.
 *
 * The id is the record. `story:cart-card--item` is what the collector wrote for
 * the story `item` of `Cart Card`, and the report carries no title beside it, so
 * the family is the part before the first `--`. An id with no `--` is a family
 * of one. A route or test id that happens to hold a `--` is cut there too.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { VariationRecord } from '@variance-authority/report';

/** One subject of a family, named by the part of its id after the family. */
export interface FamilyMember {
  readonly subject: string;
  /** The part of the id that names it within the family. */
  readonly member: string;
}

/** A member in the lattice's order, with the member it varies from when the run read the two as a pair. */
export interface FamilyColumn extends FamilyMember {
  readonly from?: string;
}

/** `story:cart-card--item` is `story:cart-card` and `item`; an id with no `--` is its own family. */
export function familyOf(id: string): { readonly family: string; readonly member: string } {
  const at = id.indexOf('--');
  return at < 0 ? { family: id, member: id } : { family: id.slice(0, at), member: id.slice(at + 2) };
}

/**
 * The family's members in the lattice's order: what nothing varies from first,
 * then what varies from it, depth first. Within a rank the shortest name leads,
 * then the name: a base is the name its variations add to, so where the run
 * read no lattice among them, `full` still comes before `loading`.
 */
export function columnsOf(
  members: readonly FamilyMember[],
  variations: readonly VariationRecord[],
): readonly FamilyColumn[] {
  const own = new Map(members.map((member) => [member.subject, member.member]));
  const parents = new Map<string, string>();
  for (const variation of variations) {
    if (variation.parent !== undefined && own.has(variation.subject) && own.has(variation.parent)) {
      parents.set(variation.subject, variation.parent);
    }
  }
  const byRank = (a: { readonly member: string }, b: { readonly member: string }): number =>
    a.member.length - b.member.length || codeUnitOrder(a.member, b.member);
  const armsOf = (parent: string | undefined): readonly FamilyColumn[] =>
    members
      .filter((member) => parents.get(member.subject) === parent)
      .sort(byRank)
      .flatMap((member): readonly FamilyColumn[] => {
        const from = parent === undefined ? undefined : own.get(parent);
        return [
          from === undefined ? { subject: member.subject, member: member.member } : { ...member, from },
          ...armsOf(member.subject),
        ];
      });
  return armsOf(undefined);
}
