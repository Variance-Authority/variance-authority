// compass: variance-authority.reach.story
/**
 * When each step of a live head's route ran, read off the stamps its story
 * carries.
 *
 * A stamp is absolute, so a head's, another head's and a later telling's are
 * on one line and every distance is a subtraction made here. A leg is the time
 * from a step to the next recorded one: what ran between them unrecorded, and
 * what the code waited for, are in it. A test's story carries no stamps, and
 * its route no times.
 */

import type stories from './format.cjs';
import type { Route, Stop } from './read.js';

/** When a step ran: its stamp, in milliseconds since the epoch, and the time to the next recorded step, where there is one. */
export interface Timing {
  readonly at: number;
  /** Absent on a page's last step, and on the last step a tape kept of an execution it lost some of. */
  readonly leg?: number;
  /** Set where the process ran other work, another execution's or none's, in the middle of the leg. */
  readonly crossed?: true;
}

/** When one telling's steps ran, in milliseconds since the epoch. */
export interface Extent {
  readonly first: number;
  readonly last: number;
  /** When the execution settled, where its head saw it settle: a page never does, nor a turn that a trace alone names. */
  readonly end?: number;
}

/** When the first recorded step of an execution ran, on any head, and how far the tellings of it reach. */
export interface Span {
  readonly start: number;
  readonly end: number;
  /** Whether `end` is where the execution ended, and not only the latest of it that was told. */
  readonly whole: boolean;
  /** How many heads stamped it, each with its own machine's clock. */
  readonly heads: number;
}

/** `stops` with when each ran, `firsts` holding the visit each opened with. */
export function timeStops(stops: readonly Stop[], firsts: readonly number[], story: ReturnType<typeof stories.decodeStory>): readonly Stop[] {
  const { stamps, crossed = [] } = story;
  if (stamps === undefined) return stops;
  const end = story.untaped === 0 ? story.end : undefined;
  let crossing = 0;
  return stops.map((stop, index): Stop => {
    const first = firsts[index]!;
    const next = firsts[index + 1] ?? stamps.length;
    const at = stamps[first]!;
    const until = next < stamps.length ? stamps[next] : end;
    while (crossing < crossed.length && crossed[crossing]! <= first) crossing += 1;
    const through = crossing < crossed.length && crossed[crossing]! <= next;
    return { ...stop, time: { at, ...(until === undefined ? {} : { leg: until - at, ...(through ? { crossed: true as const } : {}) }) } };
  });
}

/** Two passes of one step as one time: when the first ran, and the legs of both. */
export function addedTime(kept: Timing | undefined, folded: Timing | undefined): { readonly time?: Timing } {
  if (kept === undefined || folded === undefined) return kept === undefined ? {} : { time: kept };
  // A pass whose leg is not known leaves none to add up.
  if (kept.leg === undefined || folded.leg === undefined) return { time: { at: kept.at } };
  return { time: { at: kept.at, leg: kept.leg + folded.leg, ...(kept.crossed === true || folded.crossed === true ? { crossed: true as const } : {}) } };
}

/** When the steps of one telling ran, or `undefined` where it carries no stamps. */
export function extentOf({ stamps, end }: ReturnType<typeof stories.decodeStory>): Extent | undefined {
  if (stamps === undefined || stamps.length === 0) return undefined;
  return { first: stamps[0]!, last: stamps.at(-1)!, ...(end === undefined ? {} : { end }) };
}

/**
 * What each head's tellings of one execution cover, `complete` where none of it
 * is still to come or was left out; `undefined` where none is stamped. It is
 * the whole only where every head listed told, and said it settled: a head that
 * told nothing, or a page, leaves what came after what was told unknown.
 */
export function toldSpan(heads: readonly (readonly Route[])[], complete: boolean): Span | undefined {
  const stamped = heads.map((routes) => routes.flatMap(({ extent }) => extent ?? [])).filter((extents) => extents.length > 0);
  if (stamped.length === 0) return undefined;
  const extents = stamped.flat();
  const whole = complete && heads.every((routes) => routes.length > 0 && routes.every(({ extent }) => extent?.end !== undefined));
  const end = Math.max(...extents.map((one) => one.end ?? one.last));
  return { start: Math.min(...extents.map((one) => one.first)), end, whole, heads: stamped.length };
}
