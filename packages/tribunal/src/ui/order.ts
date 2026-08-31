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
 * 2. **Same props, two renderings.** Held at one commit with its inputs equal,
 *    it did not settle. An answer, not an absence.
 * 3. **Nothing explains these.** The diff was read, the file graph walked and
 *    the enclosure climbed, and none of the three arrive here.
 * 4. **The commit's own causes**, one band each — the file that was edited, or
 *    the property that took a new value. [`cause.ts`](./cause.ts) resolves them.
 * 5. **Not in the diff.** No file in the commit declares it and the run recorded
 *    no attribution to read instead.
 * 6. **No diff read.** The run carried none, so nothing above applies.
 * 7. **Already decided.** Off the queue, kept on the page.
 *
 * ## Band four used to be three bands, and they were the run's ladder
 *
 * *Edited*, *Owner edited* and *Token moved* were three headings, and they sorted
 * a build by how many hops the run needed to explain each change. Nobody has that
 * question. A reviewer edited three files and wants to know what each of the
 * three did, and under the ladder the answer to that was spread across three
 * headings with the file names in a hover title.
 *
 * So the heading is the cause. `Button` under `ui/button.tsx`; `CardFooter` under
 * `ProductCard.tsx`, because `ProductCard` draws it. Three files in, three
 * headings out — and the rung each change came in on is still on its row, where
 * it explains one component instead of naming a category.
 *
 * The bands above and below stay as they were, and that is the ranking's whole
 * point: a change with no cause in the commit must not be filed under one.
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

import type { BuildDetail } from '../review-types.js';
import { rootsOf, type Root, type Rooted } from './cause.js';
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
  readonly changes: readonly Rooted[];
  /**
   * The cause in the commit this band *is*, when it is one.
   *
   * Present on the bands that came out of [`cause.ts`](./cause.ts), where the
   * heading is a path or a property rather than a claim about a rung. Absent on
   * the rest, and the absence is what a heading renderer switches on: a file is
   * drawn as a file, and `Nothing reaches these` is drawn as a sentence.
   */
  readonly root?: Root;
}

/**
 * The nine headings, each the shortest true claim about its rows.
 *
 * None of them explains itself, and the two that name a relation — `upstream`
 * and `token` — say *that* an owner or a token moved without saying which,
 * because that answer is per row and every row carries it.
 *
 * Nobody is addressed. `Edited` and `Owner edited` were *you edited these* and
 * *you edited their owner*, which puts a person in a heading whose subject is a
 * commit — and a reviewer reading somebody else's branch is not the *you* in it.
 * The pair is also the docket's whole distinction, so they are two words each and
 * they rhyme: a change the commit declares, and a change it arrived at.
 */
const LANES: readonly { readonly lane: Lane; readonly title: string }[] = [
  { lane: 'stranded', title: 'Nothing reaches these' },
  { lane: 'reached', title: 'Edited' },
  { lane: 'contradicted', title: 'Same props, two renderings' },
  { lane: 'unexplained', title: 'Nothing explains these' },
  { lane: 'upstream', title: 'Owner edited' },
  { lane: 'token', title: 'Token moved' },
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
      why: 'Banded by what it costs to be wrong: what the commit reaches nothing in, then what it declares, then what the diff cannot name.',
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
export function docketOf(
  build: BuildDetail,
  origins: readonly Origin[],
  order: Order,
): readonly Group[] {
  const sorted = [...origins].sort(BY[order]);

  if (order !== 'story') {
    // `why` stays on `FLAT` — it is the sort button's hover text, which a reader
    // asks for, and not a paragraph the page prints at them.
    const flat = FLAT[order];
    return sorted.length === 0
      ? []
      : [{ lane: 'reached', title: flat.title, changes: sorted.map((origin) => ({ origin })) }];
  }

  // Only the three rungs a commit is the top of are rooted. The rest are the
  // findings this docket ranks *above* the commit — nothing reaches it, nothing
  // explains it, the run read no diff — and a heading naming a file the reviewer
  // edited is the wrong thing to file those under, because the point of each of
  // them is that no file the reviewer edited accounts for it.
  const rootable = sorted.filter((origin) => ROOTED.has(laneOf(origin)));
  const { roots, loose } = rootsOf(rootable, build);
  const rest = new Set(loose);

  const banded = LANES.map((band) => ({
    ...band,
    changes: sorted
      .filter((origin) => laneOf(origin) === band.lane)
      .filter((origin) => !ROOTED.has(band.lane) || rest.has(origin))
      .map((origin) => ({ origin })),
  }));

  const causes: Group[] = roots.map((root) => ({
    lane: LANE_OF_ROOT[root.kind],
    title: root.name,
    changes: root.changes,
    root,
  }));

  // The alarm bands keep the top, the commit's own causes come next, and what is
  // settled or unreadable stays at the bottom. `ALARM` is the split point rather
  // than a second list of names, so a lane added to `LANES` lands somewhere by
  // construction instead of silently vanishing from the page.
  const before = banded.filter((band) => ALARM.has(band.lane));
  const after = banded.filter((band) => !ALARM.has(band.lane));

  return [...before, ...causes, ...after].filter((band) => band.changes.length > 0);
}

/** The rungs a cause in the commit sits at the top of. */
const ROOTED: ReadonlySet<Lane> = new Set<Lane>(['reached', 'upstream', 'token']);

/** The bands that outrank the commit's own causes, because nothing in it explains them. */
const ALARM: ReadonlySet<Lane> = new Set<Lane>(['stranded', 'contradicted', 'unexplained']);

/** Which band a root is drawn in, so its colour still says how it was reached. */
const LANE_OF_ROOT: Record<Root['kind'], Lane> = {
  file: 'reached',
  token: 'token',
  component: 'upstream',
};
