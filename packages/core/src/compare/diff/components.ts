import { aggregateImpact, type PropertyImpact } from '../impact.js';
import type { Band } from '../band.js';
import { impactTag, type ChangedComponent, type Delta, type Root } from './delta.js';

/**
 * The component roll-up: who caused this change set, and who merely renders it.
 *
 * Kept apart from attribution because it runs *after* it and asks a different
 * question. Attribution decides what one sentence explains the deltas;
 * this decides which components that sentence implicates, and in what capacity.
 * The two share only the roots, which is exactly the argument for one being able
 * to change without disturbing the other.
 */

/**
 * Which components a change set implicates, and in what capacity.
 *
 * A component is a *root* when a root's own deltas name it innermost — the change
 * originated there. It is *collateral* when it only ever appears further out in
 * an owner chain, or under a token root: it renders something that changed, but
 * nothing about it changed.
 */
export function componentsOf(
  deltas: readonly Delta[],
  roots: readonly Root[],
): readonly ChangedComponent[] {
  const rootNames = new Set<string>();
  for (const root of roots) {
    if (root.kind !== 'component' && root.kind !== 'prop') continue;

    // The root's own `cause`, not the innermost owner of its deltas. For a
    // `prop` root those are different components and the innermost is the wrong
    // one: `Panel → Button` means `Panel` made the edit. Falling back to the
    // innermost keeps the previous behaviour where no cause was recorded.
    if (root.cause !== undefined) {
      rootNames.add(root.cause);
      continue;
    }

    for (const delta of root.deltas) {
      const innermost = delta.owners?.[0]?.name;
      if (innermost !== undefined) rootNames.add(innermost);
    }
  }

  const accumulator = new Map<
    string,
    { deltas: number; bands: Set<Band>; impacts: (PropertyImpact | 'structural')[]; within: Set<string> }
  >();

  for (const delta of deltas) {
    const owners = delta.owners ?? [];
    for (const [index, owner] of owners.entries()) {
      let entry = accumulator.get(owner.name);
      if (!entry) {
        entry = { deltas: 0, bands: new Set(), impacts: [], within: new Set() };
        accumulator.set(owner.name, entry);
      }

      // Only the innermost owner is credited with the delta. Every enclosing
      // component would otherwise accumulate every delta beneath it, and a page
      // component would be the biggest change in every diff, every time.
      if (index === 0) {
        entry.deltas += 1;
        entry.bands.add(delta.band);
        entry.impacts.push(impactTag(delta));
      }

      // The chain is innermost-first, so the *next* frame out is what encloses
      // this one. Recording the previous frame instead would answer "what does
      // this component contain?" — which nobody asked, and which reads as an
      // answer to "where does it show up?" until someone checks.
      const enclosing = owners[index + 1];
      if (enclosing) entry.within.add(enclosing.name);
    }
  }

  return [...accumulator.entries()]
    .map(([name, entry]) => ({
      name,
      role: rootNames.has(name) ? ('root' as const) : ('collateral' as const),
      deltaCount: entry.deltas,
      bands: [...entry.bands],
      impact: aggregateImpact(entry.impacts),
      renderedIn: [...entry.within],
    }))
    .sort((a, b) => b.deltaCount - a.deltaCount || a.name.localeCompare(b.name));
}
