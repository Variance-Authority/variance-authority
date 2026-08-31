/**
 * The renders a change is measured against — the arm a diff cannot see.
 *
 * A comparison sees the population that changed. This is the other one: sites of
 * the same component, under the *same props*, that this run read and found
 * unmoved. It is what makes an unexplained movement a finding rather than a
 * shrug, and what bounds an explained one — `Button` was edited and held in four
 * renders says the edit was to a variant those four do not use, with evidence
 * rather than with a count of what happened to be collected.
 *
 * ## The props class is the load-bearing half
 *
 * Two renders of a component given different inputs are not controls for each
 * other. They are two questions that share a name, and answering one with the
 * other is how a control group becomes a source of confident wrong answers.
 *
 * ## What disqualifies a site
 *
 * Two things, and only the first is obvious. It moved — either the run reported
 * it, or its hashes say so in a render where no region named it, which is the
 * majority case and the one that made every entry in this list wrong before
 * `hashesMoved` was carried. Or nobody looked: the subject was collected with no
 * baseline digests to compare, and *unmeasured* is not *unchanged*.
 */

import type { ComponentEntry, Site } from './composition.js';
import type { Bench, Moved } from './movement.js';

/**
 * Sites of the same component this run read and found unmoved.
 *
 * Restricted to props classes this subject actually participates in, because a
 * component rendered with different inputs elsewhere is not a control for this
 * one — it is a different question that happens to share a name.
 *
 * Two ways a site fails to be a control, and only the second is obvious. It
 * moved: the run reported it, or its hashes say so even where no region named
 * it. Or nobody looked: the subject was collected with no baseline hashes to
 * compare, and *unmeasured* is not *unchanged*.
 */
export function heldSites(
  moved: Moved,
  entry: ComponentEntry | undefined,
  bench: Bench,
): { readonly held: readonly Site[]; readonly considered: number } {
  if (entry === undefined) return { held: [], considered: 0 };

  const alsoMoved = new Set(bench.movedIn.get(moved.component) ?? []);
  const hashes = bench.evidence.hashesMoved;

  const elsewhere = entry.classes
    .filter((group) =>
      group.renderings.some((rendering) =>
        rendering.sites.some((site) => site.subject === moved.subject),
      ),
    )
    .flatMap((group) => group.renderings)
    .flatMap((rendering) => rendering.sites)
    .filter((site) => site.subject !== moved.subject);

  return {
    held: elsewhere
      .filter((site) => !alsoMoved.has(site.subject))
      .filter(
        (site) => hashes === undefined || hashes.get(site.subject)?.has(moved.component) === false,
      ),
    considered: new Set(elsewhere.map((site) => site.subject)).size,
  };
}
