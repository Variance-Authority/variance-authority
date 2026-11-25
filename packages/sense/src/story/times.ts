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

import stories from './format.cjs';
import type { Stop } from './read.js';

/** When a step ran: its stamp, in milliseconds since the epoch, and the time to the next recorded step, where there is one. */
export interface Timing {
  readonly at: number;
  /** Absent on a page's last step, and on the last step a tape kept of an execution it lost some of. */
  readonly leg?: number;
  /** Set where another execution's work ran in the middle of the leg. */
  readonly crossed?: true;
}

/** When the first recorded step of an execution ran, on any head, and when the last known of it ended. */
export interface Span {
  readonly start: number;
  readonly end: number;
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
  const legs = kept.leg === undefined && folded.leg === undefined ? {} : { leg: (kept.leg ?? 0) + (folded.leg ?? 0) };
  return { time: { at: kept.at, ...legs, ...(kept.crossed === true || folded.crossed === true ? { crossed: true as const } : {}) } };
}

/** From the first stamp of the stories told of one execution to the last, or `undefined` where none carries any. */
export function toldSpan(told: readonly Uint8Array[]): Span | undefined {
  let span: Span | undefined;
  for (const bytes of told) {
    const { stamps, end } = stories.decodeStory(bytes);
    if (stamps === undefined || stamps.length === 0) continue;
    const last = end ?? stamps.at(-1)!;
    span = { start: Math.min(stamps[0]!, span?.start ?? Infinity), end: Math.max(last, span?.end ?? -Infinity) };
  }
  return span;
}

/** When a step ran within `span`, as a reader reads it: `+10.0 ms, then 30.0 ms (60%)`. */
export function timeText(time: Timing, span: Span): string {
  const at = `+${duration(time.at - span.start)}`;
  if (time.leg === undefined) return at;
  const whole = span.end - span.start;
  const share = whole > 0 ? Math.round((time.leg / whole) * 100) : 0;
  return `${at}, then ${duration(time.leg)} (${share}%)${time.crossed === true ? ", another execution's work in it" : ''}`;
}

/** What a span's steps are placed in: when it began and how long it was. */
export function spanText(span: Span): string {
  return `began ${new Date(span.start).toISOString()}, ${duration(span.end - span.start)} in all; each step: when it ran, then the time to the next recorded step and its share`;
}

/** Below a second a step's own tenths, which {@link durationText} rounds away. */
function duration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds.toFixed(1)} ms` : durationText(milliseconds);
}
