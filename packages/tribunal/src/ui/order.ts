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
 * 1. **Nothing reaches these.** The commit arrives at no component at all in some
 *    render each of these moved in — the one finding here no other tool
 *    produces, and the one worth waking somebody for.
 * 2. **You edited these.** The commit arrives at the component. Most of a
 *    healthy build.
 * 3. **Same props, two renderings.** Held at one commit with its inputs equal,
 *    it did not settle. An answer, not an absence.
 * 4. **Nothing explains these.** The diff was read, the file graph walked and
 *    the enclosure climbed, and none of the three arrive here.
 * 5. **You edited their owner.** The dominoes. Nothing in the commit declares
 *    the component; something in the commit draws it and hands it what it
 *    renders. The row names that owner.
 * 6. **Their token moved.** A custom property took a new value, and this reads
 *    it. The row names the property.
 * 7. **Not in the diff.** No file in the commit declares it and the run recorded
 *    no attribution to read instead.
 * 8. **No diff read.** The run carried none, so nothing above applies.
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
 * ## A band is a label, not a paragraph
 *
 * Each of these used to ship with its definition printed underneath the heading,
 * every build, unchanged. The definition is the same on every build; the names
 * are not, and the names were the part left in the record. So the heading is a
 * claim of a few words and the evidence is on the row that has it —
 * [`sourceOf`](./grouping.ts) reads the owner, the file or the token off the
 * movement the run wrote, and the rail prints it.
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

/** One band of the docket: a claim of a few words, and the rows it holds. */
export interface Group {
  readonly lane: Lane;
  readonly title: string;
  readonly changes: readonly Origin[];
}

/**
 * The nine headings, each the shortest true claim about its rows.
 *
 * None of them explains itself, and the two that name a relation — `upstream`
 * and `token` — say *whose* and *which* without saying who or which, because
 * that answer is per row and every row carries it.
 */
const LANES: readonly { readonly lane: Lane; readonly title: string }[] = [
  { lane: 'stranded', title: 'Nothing reaches these' },
  { lane: 'reached', title: 'You edited these' },
  { lane: 'contradicted', title: 'Same props, two renderings' },
  { lane: 'unexplained', title: 'Nothing explains these' },
  { lane: 'upstream', title: 'You edited their owner' },
  { lane: 'token', title: 'Their token moved' },
  { lane: 'unnamed', title: 'Not in the diff' },
  { lane: 'unread', title: 'No diff read' },
  { lane: 'decided', title: 'Already decided' },
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
    // `why` stays on `FLAT` — it is the sort button's hover text, which a reader
    // asks for, and not a paragraph the page prints at them.
    const flat = FLAT[order];
    return sorted.length === 0 ? [] : [{ lane: 'reached', title: flat.title, changes: sorted }];
  }

  return LANES.map((band) => ({
    ...band,
    changes: sorted.filter((origin) => laneOf(origin) === band.lane),
  })).filter((band) => band.changes.length > 0);
}
