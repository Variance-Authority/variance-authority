/**
 * The bands a component did not move in on its own, and who moved them.
 *
 * A revision that restyles a button and also adds a label to one of the places
 * that mounts it produces one reading per render, and the change page unions
 * them: *Button moved in what it announces, its layout and its style values*.
 * Two of those three are the button's file. The first is a prop, written in a
 * card, and the button is where it arrived. A reviewer told the button announces
 * something new goes to `button.tsx` and finds nothing that could have done it.
 *
 * Nothing new is measured here. The three records that separate the two already
 * land: which bands moved per render, which subjects each component is drawn in,
 * and which components the diff reaches.
 *
 * ## The control group is the whole claim
 *
 * A band belongs to a parent when the renders it moved in are *exactly* the
 * renders that parent draws — every one of them, and no other. `a11y` moving in
 * the six renders `ProductCard` draws and holding still in the ten it does not
 * is a partition, and a partition is evidence. Overlap is not: `geometry` also
 * moved in the button's own small-size stories, which no card draws, so the
 * cards cannot be what moved it.
 *
 * Which makes the other half load-bearing. **Without renders where the band held
 * still there is no claim to make.** `token` moved everywhere the button is
 * drawn, and every ancestor of the button trivially covers *everywhere* — so a
 * rule that skipped the control group would hand the button's own restyle to
 * whichever card sorted first. `CardFooter` is the honest version of the same
 * shape: it is drawn in six renders, moved in all six, and is very probably
 * carrying somebody else's props — and this says nothing about it, because the
 * suite contains no render that would have distinguished the two.
 *
 * ## Why the holder has to be in the diff
 *
 * A parent the commit never touched hands nothing new down: whatever it passes,
 * it passed in the baseline too. Requiring the reach walk to arrive at the
 * holder is what keeps a coincidence — a container that happens to be drawn in
 * exactly those six renders — from being read as a cause.
 *
 * ## What it will not say
 *
 * That the holder is *why* the pixels differ. It owns the band: the thing that
 * moved in this sense is written in its file, and the decision belongs there.
 * The run's own sentence, on the movement rows, is the answer to *why*.
 */

import type { BuildDetail, Placement } from '../review-types.js';
import { loudestFirst } from './sense.js';

/** One band a component moved in that a parent, not its own file, owns. */
export interface Handed {
  readonly band: string;
  /** Every parent the partition fits, sorted. Never empty, and rarely not one. */
  readonly holders: readonly string[];
  /** Renders the band moved in — all of them, and all of them drawn by the holders. */
  readonly moved: number;
  /** Renders this component was drawn and read in where the band held still. */
  readonly held: number;
}

/** One build's separation of a component's own movement from what it was given. */
export type Handing = (component: string) => readonly Handed[];

const NONE: readonly Handed[] = [];

export function handedTo(build: BuildDetail): Handing {
  const census = build.composition;
  // `whole` is the run refusing to attribute the diff at all, which is a missing
  // input and not an empty reach. Either way there is no walk, and with no walk
  // every parent is unreached and nothing here can be said.
  const graph = build.reach !== null && build.reach.whole === undefined ? build.reach : null;
  if (census === null || graph === null) return () => NONE;

  const places = new Map(census.map((each) => [each.component, each]));
  const reached = new Set(graph.components.map((each) => each.component));

  // Only the renders that compared hashes. A subject whose baseline carried none
  // is not a render where a band held still — it is a render nobody read, and
  // counting it as a control would let any parent partition anything.
  const read = build.subjects.filter((subject) => subject.moved !== undefined);

  return (component) => {
    const place = places.get(component);
    if (place === undefined) return NONE;

    const drawn = new Set(place.subjects);
    const bands = new Map<string, ReadonlySet<string>>();
    for (const subject of read) {
      if (!drawn.has(subject.subject)) continue;
      const entry = (subject.moved ?? []).find((each) => each.component === component);
      bands.set(subject.subject, new Set<string>(entry?.bands ?? []));
    }
    if (bands.size === 0) return NONE;

    const above = enclosing(component, places).filter((name) => reached.has(name));
    if (above.length === 0) return NONE;

    const found: Handed[] = [];
    for (const band of loudestFirst(new Set([...bands.values()].flatMap((each) => [...each])))) {
      const moved: string[] = [];
      const held: string[] = [];
      for (const [subject, sensed] of bands) (sensed.has(band) ? moved : held).push(subject);
      if (held.length === 0) continue;

      const holders = above.filter((name) => {
        const subjects = new Set(places.get(name)?.subjects ?? []);
        if (held.some((each) => subjects.has(each))) return false;
        return moved.every((each) => subjects.has(each));
      });
      if (holders.length === 0) continue;

      found.push({ band, holders: [...holders].sort(), moved: moved.length, held: held.length });
    }
    return found;
  };
}

/**
 * Every component that encloses this one anywhere in the suite.
 *
 * All depths, not the nearest: a prop written two rungs up arrives just the
 * same, and the partition is what decides whether the rung is the right one.
 * `seen` starts holding the component itself, so a render tree folded over a
 * suite — a menu inside its own submenu — terminates instead of closing a loop.
 */
function enclosing(component: string, places: ReadonlyMap<string, Placement>): readonly string[] {
  const found = new Set<string>();
  const queue = [...(places.get(component)?.within ?? [])];
  const seen = new Set([component]);
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    found.add(name);
    queue.push(...(places.get(name)?.within ?? []));
  }
  return [...found].sort();
}
