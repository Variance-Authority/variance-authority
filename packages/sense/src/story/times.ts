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

import { durationText } from '@variance-authority/core/shard';

import type stories from './format.cjs';
import type { Route, Stop } from './read.js';

/** When a step ran: its stamp, in milliseconds since the epoch, and the time to the next recorded step, where there is one. */
export interface Timing {
  readonly at: number;
  /** Absent on a page's last step, and on the last step a tape kept of an execution it lost some of. */
  readonly leg?: number;
  /** Set where another execution's work ran in the middle of the leg. */
  readonly crossed?: true;
}

/** When one telling's steps ran, in milliseconds since the epoch. */
export interface Extent {
  readonly first: number;
  readonly last: number;
  /** When the execution settled, where its head saw it settle: a page never does. */
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

/** What each head's tellings of one execution cover, `complete` where none of it is still to come or was left out; `undefined` where none is stamped. */
export function toldSpan(heads: readonly (readonly Route[])[], complete: boolean): Span | undefined {
  const stamped = heads.map((routes) => routes.flatMap(({ extent }) => extent ?? [])).filter((extents) => extents.length > 0);
  if (stamped.length === 0) return undefined;
  const extents = stamped.flat();
  const end = Math.max(...extents.map((one) => one.end ?? one.last));
  return { start: Math.min(...extents.map((one) => one.first)), end, whole: complete && extents.some((one) => one.end === end), heads: stamped.length };
}

/**
 * How long after one telling of an execution the next began, `, 100.0 ms (50%)
 * after the above ended`, or nothing where either carries no times, or where
 * they overlap: two processes of one head name tell theirs side by side. Its
 * end is the head's word for it; without one, the last visit recorded.
 * It is no step's time, and where the watcher left tellings out, `untold`, one
 * may have run in it.
 */
export function gapText(before: Route, after: Route, span: Span, untold: boolean): string {
  const [told, next] = [before.extent, after.extent];
  if (told === undefined || next === undefined) return '';
  const gap = next.first - (told.end ?? told.last);
  if (gap < 0) return '';
  const from = told.end === undefined ? 'the last recorded of the above' : 'the above ended';
  return `, ${shareText(gap, span)} after ${from}${untold ? ', where a telling not kept may have run' : ''}`;
}

/** When a step ran within `span`, as a reader reads it: `+10.0 ms, then 30.0 ms (60%)`. */
export function timeText(time: Timing, span: Span): string {
  const at = `+${duration(time.at - span.start)}`;
  if (time.leg === undefined) return at;
  return `${at}, then ${shareText(time.leg, span)}${time.crossed === true ? ", another execution's work in it" : ''}`;
}

/** What a span's steps are placed in: when it began and how long it was, or how far the tellings of it reach. */
export function spanText(span: Span): string {
  const length = `${duration(span.end - span.start)} ${span.whole ? 'in all' : 'as far as it was recorded'}`;
  const clocks = span.heads > 1 ? "; heads are placed by their own machines' clocks" : '';
  return `began ${new Date(span.start).toISOString()}, ${length}; each step: when it ran, then the time to the next recorded step and its share${clocks}`;
}

/** A part of `span`, as its length and its share of the whole. */
function shareText(milliseconds: number, span: Span): string {
  const whole = span.end - span.start;
  return `${duration(milliseconds)} (${whole > 0 ? Math.round((milliseconds / whole) * 100) : 0}%)`;
}

/** Below a second a step's own tenths, which {@link durationText} rounds away. */
function duration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds.toFixed(1)} ms` : durationText(milliseconds);
}
