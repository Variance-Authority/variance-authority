/**
 * Stories of one component that rendered one image, read off the keys the store
 * already holds.
 *
 * An image is stored under the SHA-256 of its PNG, so two subjects whose
 * `after_key` is one key painted the same bytes. Nothing new is uploaded and
 * nothing is hashed here: the key is the digest the ingest already took.
 *
 * Grouped within a family, never across one. Two components that both render an
 * empty box agree with each other; two stories of one component that render one
 * box are a story that varies nothing, and that is what a reviewer can act on —
 * an arm whose flag reaches no pixel, or `dark-narrow` and `narrow-dark`, one
 * render under two names. The run's own `VariationRecord.identical` answers the
 * first only for a pair it linked, and the second never, since no link joins
 * them.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { VariationRecord } from '@variance-authority/report';
import { columnsOf, familyOf, type FamilyMember } from './family.js';
import type { SameImage } from './review-types.js';

/** One subject and the key its candidate is stored under; no key, no candidate. */
export interface Candidate {
  readonly subject: string;
  readonly after: string | undefined;
}

/**
 * Every group of two or more stories of one component with one candidate key,
 * by family, then by where the group's first story sits in the family's lattice.
 *
 * A subject with no candidate is in no group: nothing was painted to compare, and
 * placing it beside one that was would say it rendered the same.
 */
export function sameImage(
  candidates: readonly Candidate[],
  variations: readonly VariationRecord[],
): readonly SameImage[] {
  const families = new Map<string, FamilyMember[]>();
  const keys = new Map<string, string>();
  for (const { subject, after } of candidates) {
    // FIXME: a story that settled on its baseline's digest kept no candidate and
    // is skipped here, though its picture is that baseline's. The build does not
    // record which baseline it settled on, so a pair is named only on the build
    // that introduced or changed it.
    if (after === undefined) continue;
    const { family, member } = familyOf(subject);
    families.set(family, [...(families.get(family) ?? []), { subject, member }]);
    keys.set(subject, after);
  }

  return [...families.keys()].sort(codeUnitOrder).flatMap((family) => {
    const byKey = new Map<string, string[]>();
    for (const column of columnsOf(families.get(family) ?? [], variations)) {
      const key = keys.get(column.subject) as string;
      byKey.set(key, [...(byKey.get(key) ?? []), column.subject]);
    }
    return [...byKey.values()]
      .filter((subjects) => subjects.length > 1)
      .map((subjects) => ({ family, subjects }));
  });
}
