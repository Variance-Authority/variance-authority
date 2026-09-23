/**
 * How far a component is from the edit, in the graph the diff already walked.
 *
 * A page that lists what moved beside a change has answered *what else* and left
 * the question a reviewer asks next. `Card` moved in its layout beside `Button`:
 * is that the card the button is nailed into, or a card on the other side of the
 * app that happens to share a token? The first is arithmetic. The second is the
 * finding — an edit whose consequence arrives somewhere with no import path to
 * it has either found a global, or found a bug.
 *
 * Nothing new is measured for this. `ReachedComponent.trail` is the shortest
 * chain from a file the commit changed to the component, every step a path but
 * the last, so the file a component is declared in is the step before its name
 * and the hops between two components are an index arithmetic away. Where the
 * traversal never arrived, the docket's own causes still carry a file, and a
 * name with a file beside it is placed even when it is not reached.
 *
 * ## What it will not say
 *
 * Nothing about the DOM. Two components can be siblings in a render and unrelated
 * in the module graph, and the reverse — a layout that imports a button it never
 * renders. This answers *how the edit could have got there*, which is the
 * question a reviewer holding a diff is in a position to act on; where the boxes
 * sit relative to each other is the picture's job.
 *
 * `unknown` is a state and not a zero. A run with no diff has no graph, and a
 * surface that drew every distance as *unrelated* would turn a missing input into
 * a page full of alarms.
 */

import type { BuildDetail } from '../review-types.js';

export type Distance =
  /** Declared in the same file the change is. */
  | { readonly kind: 'same-file' }
  /** Reached through the change's file: it imports the change, `hops` files out. */
  | { readonly kind: 'importer'; readonly hops: number }
  /** The change is reached through this one's file, `hops` files out. */
  | { readonly kind: 'imported'; readonly hops: number }
  /** The commit reaches it, by a chain that does not pass the change at all. */
  | { readonly kind: 'apart' }
  /**
   * Off the traversal, but the build knows where it is declared.
   *
   * The interesting half of what used to be one negative. A component the walk
   * never arrived at is not thereby unplaced: the report's own causes carry the
   * file most of them are declared in, and *`ui/card.tsx`, which this commit did
   * not change* is a location a reviewer can act on where *not reached* is a
   * shrug.
   */
  | { readonly kind: 'declared'; readonly file: string; readonly edited: boolean }
  /** Nothing in the commit reaches it and no record says where it lives. */
  | { readonly kind: 'unreached' }
  /** No diff was read, so there is no graph to measure in. */
  | { readonly kind: 'unknown' };

/** Distance from one fixed component to any other, over one build's reach. */
export type Ruler = (component: string) => Distance;

/** The path out of a cause's `file`, which carries the declaring line after it. */
function pathOf(file: string): string {
  return file.replace(/:\d+(?::\d+)?$/, '');
}

export function distanceFrom(build: BuildDetail, component: string): Ruler {
  const reach = build.reach !== null && build.reach.whole === undefined ? build.reach : null;
  if (reach === null) return () => ({ kind: 'unknown' });

  const trails = new Map(reach.components.map((each) => [each.component, each.trail]));
  const declared = new Map(
    build.causes.flatMap((cause) =>
      cause.file === undefined ? [] : [[cause.component, pathOf(cause.file)] as const],
    ),
  );
  const edited = new Set(reach.changed);

  // The traversal first, the docket second. A trail is a path *and* a distance;
  // a cause's file is only a place, and it is what there is when the walk never
  // arrived.
  const fileOf = (name: string): string | undefined =>
    trails.get(name)?.at(-2) ?? declared.get(name);

  const home = trails.get(component);
  const homeFile = fileOf(component);

  return (other) => {
    const file = fileOf(other);
    if (file !== undefined && file === homeFile) return { kind: 'same-file' };

    const trail = trails.get(other);
    if (trail === undefined) {
      return file === undefined
        ? { kind: 'unreached' }
        : { kind: 'declared', file, edited: edited.has(file) };
    }
    if (home === undefined || homeFile === undefined) return { kind: 'apart' };

    const through = trail.indexOf(homeFile);
    if (through >= 0) return { kind: 'importer', hops: trail.length - 2 - through };

    const under = file === undefined ? -1 : home.indexOf(file);
    if (under >= 0) return { kind: 'imported', hops: home.length - 2 - under };

    return { kind: 'apart' };
  };
}

/**
 * Whether the records put this component anywhere at all relative to the change.
 *
 * The distinction a row has to draw before it prints anything. A page that gave
 * every unplaced component the same chip printed *the diff does not name it* nine
 * times down one list — a column constant over every row, costing nine lines to
 * say one thing, and saying it as though it were a property of each component
 * rather than of the graph. Unplaced rows carry no chip; the list says once, at
 * its foot, that it could not place them.
 */
export function placed(distance: Distance): boolean {
  return distance.kind !== 'unreached' && distance.kind !== 'unknown';
}

/**
 * The distance in words, or nothing when there is nothing to say.
 *
 * `unknown` returns nothing rather than a sentence about the run: a reviewer
 * reading a list of components does not need each row to repeat that this build
 * carried no diff, and the page says it once elsewhere.
 */
export function howFar(distance: Distance): string | undefined {
  switch (distance.kind) {
    case 'same-file':
      return 'same file';
    case 'importer':
      return distance.hops === 1 ? 'imports it' : `imports it, ${String(distance.hops)} files out`;
    case 'imported':
      return distance.hops === 1
        ? 'imported by it'
        : `imported by it, ${String(distance.hops)} files out`;
    case 'apart':
      return 'reached by a separate path';
    case 'declared':
      return distance.edited
        ? `${basename(distance.file)}, which this commit changed`
        : `${basename(distance.file)}, untouched by this commit`;
    case 'unreached':
    case 'unknown':
      return undefined;
  }
}

/** The last segment, because a row has no width for `app/src/components/ui/`. */
function basename(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

/** One rung of the blast radius: components this many imports from an edited file. */
export interface Depth {
  /** Imports between a file the commit changed and this component's file. */
  readonly depth: number;
  /** Components the commit reaches at this depth. */
  readonly reached: number;
  /** How many of them this build recorded as moving. */
  readonly moved: number;
}

/**
 * A component that moved and that no file in this commit declares.
 *
 * The subjects come with it because they are what makes the *why* answerable.
 * The census that knows which components enclose this one knows it over the
 * whole suite, so an unconstrained walk out of `CardFooter` arrives at the cart
 * as readily as at the product page. Held to the subjects it actually moved in,
 * it arrives at the one the commit changed. [`holding.ts`](./holding.js) does
 * that walk.
 */
export interface Unplaced {
  readonly component: string;
  /** Subjects this build recorded it moving in, in report order. */
  readonly subjects: readonly string[];
}

export interface Spread {
  readonly rungs: readonly Depth[];
  /**
   * Components that moved and that no file in this commit declares.
   *
   * The histogram cannot hold these and must not be read as if it had: every
   * rung is *distance from an edited file*, and a component the traversal never
   * arrived at has no distance. Left out silently, a build whose loudest movement
   * is entirely off the graph reads as a build that stayed inside its own diff —
   * which is the reassurance this surface exists to withhold.
   */
  readonly undeclared: readonly Unplaced[];
}

/**
 * The impact-depth histogram: how far out the commit's consequences landed.
 *
 * Depth 0 is a component declared in a file the diff names, and everything above
 * it is collateral in the only sense that can be measured without guessing — the
 * edit is N imports away from the thing that moved. A commit whose movement is
 * all at depth 0 did what it said. One with eleven components moving at depth 3
 * changed something shared, and that is worth knowing before opening the first
 * change rather than after opening the eleventh.
 *
 * `moved` is read from the hashes first and the regions second, because those are
 * the two records that make the claim, and a component that only appears as a
 * region lead is still a component this build says moved.
 */
export function spreadOf(build: BuildDetail): Spread | null {
  const reach = build.reach !== null && build.reach.whole === undefined ? build.reach : null;
  if (reach === null) return null;

  // Where, and not only whether. The name alone answers the histogram's question;
  // the subjects are what a walk up the composition has to be held to.
  const moved = new Map<string, string[]>();
  const note = (component: string, subject: string): void => {
    const where = moved.get(component);
    if (where === undefined) moved.set(component, [subject]);
    else if (!where.includes(subject)) where.push(subject);
  };

  for (const subject of build.subjects) {
    if (subject.verdict !== 'changed') continue;
    for (const entry of subject.moved ?? []) {
      if (entry.cause) note(entry.component, subject.subject);
    }
    for (const region of subject.regions) {
      if (region.cause === true && region.component !== undefined) {
        note(region.component, subject.subject);
      }
    }
  }

  const rungs = new Map<number, { reached: number; moved: number }>();

  for (const each of reach.components) {
    const depth = Math.max(each.trail.length - 2, 0);
    const rung = rungs.get(depth) ?? { reached: 0, moved: 0 };
    rung.reached += 1;
    if (moved.has(each.component)) rung.moved += 1;
    rungs.set(depth, rung);
  }

  const named = new Set(reach.components.map((each) => each.component));

  return {
    rungs: [...rungs.entries()]
      .map(([depth, rung]) => ({ depth, ...rung }))
      .sort((left, right) => left.depth - right.depth),
    undeclared: [...moved]
      .filter(([component]) => !named.has(component))
      .map(([component, subjects]) => ({ component, subjects }))
      .sort((left, right) => left.component.localeCompare(right.component)),
  };
}
