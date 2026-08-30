/**
 * What order the changes are read in — which is the docket's whole argument.
 *
 * A list of changes with no order is a list of screenshots with extra steps. The
 * first version of this page emitted them largest-first, which is the category's
 * ranking and is wrong for the same reason ranking regions by area is wrong: the
 * biggest number on a restyle belongs to whichever container reflowed furthest,
 * and a reviewer who works down that list spends their attention in inverse order
 * to where it is worth anything.
 *
 * So the docket is banded, and the bands are ranked by *what it costs to be
 * wrong about them* rather than by size or by count.
 *
 * 1. **Nothing in the commit reaches it, in a render the commit reaches nothing
 *    in.** The one finding on this page that no other tool can produce, and the
 *    one worth waking somebody for.
 * 2. **The commit reaches it.** Ordinary work: you edited this, and here is what
 *    it did. Most of a healthy build.
 * 3. **It renders more than one way from the same props.** Held at one commit
 *    with its inputs equal, it did not settle. An answer, not an absence: the
 *    change is not in its own code and not in what it was handed, and every
 *    comparison underneath it is worth less until that is dealt with.
 * 4. **Nothing in the run explains it.** The diff was read, the file graph
 *    walked and the enclosure climbed, and none of the three arrive here. This
 *    is the band that used to be missing: it was folded into the one below, so a
 *    component the run had actively failed to explain was shown beside a
 *    component the run had explained perfectly well and only by a route the
 *    import graph cannot travel.
 * 5. **Something you edited hands it what it draws.** The victims. Nothing in
 *    the commit declares the component; something in the commit draws it, and
 *    what moved is what it was given.
 * 6. **A value it reads took a new value.** A token moved, and this read it.
 * 7. **The diff does not name it, and nothing above was found.** What is left
 *    when every rung has been tried and none held.
 * 8. **No diff was read.** The run carried none, so nothing above applies.
 * 9. **Already decided.** Off the queue, kept on the page.
 *
 * Bands three through seven are one band as far as the *file graph* is concerned —
 * every one of them is a component the diff does not name. What separates them is
 * the run's own attribution, which climbs the other way, and which the store used
 * to drop at the door.
 *
 * Inside a band, **by component name**, ascending. Not by size: a reviewer works
 * a docket by looking for the name they recognise, and a list whose order changes
 * with the pixel count is a list they have to re-read from the top every build.
 *
 * ## The other three orders are the reader's, and they are addresses
 *
 * Someone auditing a restyle wants the largest first; someone checking blast
 * radius wants the widest first; someone who knows the name wants the alphabet
 * and nothing else. Those are in the URL rather than in a component's state, so
 * the arrangement travels with the link.
 */

import type { Origin } from './grouping.js';
import type { Order } from './route.js';

/** Which band a change is read in. */
export type Lane =
  | 'stranded'
  | 'reached'
  | 'contradicted'
  | 'unexplained'
  | 'upstream'
  | 'token'
  | 'unnamed'
  | 'unread'
  | 'decided';

/** One band of the docket, with the sentence that says why it is a band. */
export interface Group {
  readonly lane: Lane;
  readonly title: string;
  readonly why: string;
  readonly changes: readonly Origin[];
}

const LANES: readonly { readonly lane: Lane; readonly title: string; readonly why: string }[] = [
  {
    lane: 'stranded',
    title: 'Nothing you wrote reaches these',
    why: 'The commit reaches no component at all in at least one render each of these moved in. Something changed there that the diff cannot account for — a dependency, an asset, the environment, or a difference in the run itself.',
  },
  {
    lane: 'reached',
    title: 'You edited these',
    why: 'The commit arrives at the component, by a path the file graph can name. This is the part of the build you asked for.',
  },
  {
    lane: 'contradicted',
    title: 'These render two ways from the same props',
    why: 'Held at this one commit with their inputs equal, each of these produced more than one rendering. That is a finding rather than a gap: whatever moved is not in the component’s own code and not in what a parent handed it, and every comparison drawn underneath one of these is worth less until it settles.',
  },
  {
    lane: 'unexplained',
    title: 'The run explains these with nothing',
    why: 'No file in the commit declares them, no component the commit edited draws them, and no value they read moved. Three records were asked and none of them arrive here — so either something outside this commit changed, or the render does not read the same way twice.',
  },
  {
    lane: 'upstream',
    title: 'Something you edited hands these what they draw',
    why: 'Nothing in the commit declares these components, and they did not change. A component the commit did edit draws each one and hands it what it renders, so what moved here is that edit arriving. The decision belongs to the parent; these are where it landed.',
  },
  {
    lane: 'token',
    title: 'A value these read took a new value',
    why: 'Nothing in the commit declares these components. Each reads a custom property whose resolved value moved in this run, which is the whole of the difference — one decision, however many renders it reached.',
  },
  {
    lane: 'unnamed',
    title: 'The diff does not name these',
    why: 'No file in this commit declares the component, and the run recorded no attribution to read instead — either it composed no census, or it predates the one this page reads. The commit still reaches the renders they moved in.',
  },
  {
    lane: 'unread',
    title: 'This run read no diff',
    why: 'Nothing was compared against a source revision, so nothing here says whether the commit reaches these or not. Absence of a path is not absence of a cause.',
  },
  {
    lane: 'decided',
    title: 'Already decided',
    why: 'Every render under these carries somebody’s name. Kept on the docket, because a decision is part of the build and not something that disappears once it is made.',
  },
];

/**
 * Which band one change belongs to.
 *
 * `decided` first and unconditionally: a change nobody has to act on is not an
 * alarm however it arrived, and leaving it in the alarm band would put a settled
 * finding at the top of the page every build until the branch merges.
 */
export function laneOf(origin: Origin): Lane {
  if (origin.appearances.every(({ subject }) => subject.decision !== null)) return 'decided';
  if (origin.reached === undefined) return 'unread';
  if (origin.reached) return 'reached';
  if ((origin.stranded ?? []).length > 0) return 'stranded';

  // Everything below here is *the diff does not name it*, which was one band and
  // is four. The reach graph has said all it can — it climbs from a changed file
  // through its importers, so anything a changed file draws is off it by
  // construction — and what separates these is the run's own walk in the other
  // direction. A missing attribution stays in the last band rather than becoming
  // a rung of its own.
  switch (origin.cause) {
    case 'unexplained':
      return 'unexplained';
    // Not folded in with the one above, which it used to be. `unexplained` says
    // three records were asked and none of them arrive; `contradicted` says one
    // of them answered — the component disagreed with itself at fixed props —
    // and printing that under *none of them arrive here* is the page telling a
    // reviewer the run found nothing about a render it had pinned.
    case 'contradicted':
      return 'contradicted';
    case 'upstream':
      return 'upstream';
    case 'token':
      return 'token';
    default:
      return 'unnamed';
  }
}

/** How wide a change is: the renders it showed up in. */
function places(origin: Origin): number {
  return origin.appearances.length;
}

const BY: Record<Order, (left: Origin, right: Origin) => number> = {
  story: (left, right) => left.component.localeCompare(right.component),
  name: (left, right) => left.component.localeCompare(right.component),
  size: (left, right) => right.pixels - left.pixels || left.component.localeCompare(right.component),
  places: (left, right) =>
    places(right) - places(left) || left.component.localeCompare(right.component),
};

const FLAT: Record<Exclude<Order, 'story'>, { readonly title: string; readonly why: string }> = {
  name: {
    title: 'Every change, by component',
    why: 'The alphabet, and nothing else. For when you know the name you are looking for.',
  },
  size: {
    title: 'Every change, largest first',
    why: 'By the pixels the component’s own regions moved. Useful for auditing a restyle, and misleading as a default: the biggest number on a page belongs to whatever reflowed furthest, not to what was edited.',
  },
  places: {
    title: 'Every change, widest first',
    why: 'By how many renders each showed up in. This is blast radius, not severity — one token can be the widest change in a build and the least interesting one.',
  },
};

/**
 * The four arrangements, as the picker draws them.
 *
 * Named for what the reader gets rather than for the field sorted on, and the
 * default is `Story` because the docket's own argument is that a build is read as
 * one — the unreachable first, the work you asked for next.
 */
export const ORDERS: readonly { readonly order: Order; readonly label: string; readonly why: string }[] =
  [
    {
      order: 'story',
      label: 'Story',
      why: 'Banded by what it costs to be wrong: what the commit reaches nothing in, then what you edited, then what the diff cannot name.',
    },
    { order: 'name', label: 'A–Z', why: FLAT.name.why },
    { order: 'size', label: 'Largest', why: FLAT.size.why },
    { order: 'places', label: 'Widest', why: FLAT.places.why },
  ];

/**
 * The docket, arranged.
 *
 * Empty bands are dropped rather than drawn empty, because a heading over nothing
 * is a heading a reader has to check. The three flat orders return one group, so
 * every renderer downstream draws the same shape whichever arrangement it got.
 */
export function docketOf(origins: readonly Origin[], order: Order): readonly Group[] {
  const sorted = [...origins].sort(BY[order]);

  if (order !== 'story') {
    const flat = FLAT[order];
    return sorted.length === 0 ? [] : [{ lane: 'reached', ...flat, changes: sorted }];
  }

  return LANES.map((band) => ({
    ...band,
    changes: sorted.filter((origin) => laneOf(origin) === band.lane),
  })).filter((band) => band.changes.length > 0);
}
