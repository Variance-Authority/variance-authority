import { describe, expect, it } from 'vitest';
import type { PushResult } from './push.js';
import { formatPush, pushTicker, type TickerClock } from './push-progress.js';

/**
 * What a push says while it is still going, and what it says about how long.
 *
 * The failure this file exists for: a push of a real suite prints its address
 * and then nothing for tens of seconds while it reads, encodes and sends, and
 * an operator watching that cannot tell a slow upload from an endpoint that is
 * never going to answer. Silence is the bug, and the two readings of it call
 * for opposite responses — wait, or interrupt.
 *
 * So every assertion here is about a line arriving, and about it carrying the
 * one number a person waiting actually uses.
 */

/** A clock a test drives, so a heartbeat is asserted rather than waited for. */
function clockAt(): TickerClock & { at: number; beat: () => void } {
  const handle = {
    at: 0,
    beat: (): void => {
      /* replaced when a timer is running */
    },
    now: () => handle.at,
    every: (_ms: number, run: () => void) => {
      handle.beat = run;
      return () => {
        handle.beat = () => {
          /* stopped */
        };
      };
    },
  };
  return handle;
}

describe('showing progress to whoever is reading', () => {
  function ticker(tty: boolean, clock?: TickerClock) {
    const written: string[] = [];
    return { written, ...pushTicker((text) => written.push(text), tty, clock) };
  }

  it('rewrites one line on a terminal, and clears it before the report lands', () => {
    const tick = ticker(true);
    tick.on({ phase: 'encoding', done: 0, total: 2, bytes: 0 });
    tick.on({ phase: 'encoding', subject: 'a', done: 1, total: 2, bytes: 2048 });
    tick.on({ phase: 'sending', bytes: 4096 });
    tick.done();

    expect(tick.written.every((text) => text.startsWith('\r'))).toBe(true);
    expect(tick.written.some((text) => text.includes('\n'))).toBe(false);
    expect(tick.written[1]).toContain('encoding 1/2 — 2 KiB');
    expect(tick.written[2]).toContain('sending 4 KiB');
    // The last write leaves the cursor on an empty line, so `formatPush` starts
    // at a column nobody else is using.
    expect(tick.written.at(-1)?.trim()).toBe('');
  });

  it('pads a shorter line over a longer one, so a count cannot read as two counts', () => {
    const tick = ticker(true);
    tick.on({ phase: 'encoding', subject: 'a', done: 1, total: 2, bytes: 1024 * 1024 });
    tick.on({ phase: 'sending', bytes: 1024 });

    const [long, short] = tick.written;
    expect(short?.length).toBe(long?.length);
  });

  it('writes whole lines and no cursor tricks when nothing is watching', () => {
    const tick = ticker(false);
    tick.on({ phase: 'encoding', done: 0, total: 21, bytes: 0 });
    tick.on({ phase: 'encoding', subject: 'a', done: 1, total: 21, bytes: 2048 });
    tick.on({ phase: 'sending', bytes: 8_081_920 });
    tick.done();

    // Two lines for two phases, and nothing per subject: a build log is read
    // afterwards, where every intermediate count is noise.
    expect(tick.written).toEqual([
      '  encoding 21 subject(s) of images\n',
      '  sending 7893 KiB in one request\n',
    ]);
  });

  it('keeps drawing while the one request it cannot measure is in flight', () => {
    // The whole of the reported failure: `sending` produces no events, so a line
    // drawn once and left alone is the same silence with a sentence in front of
    // it. A second that climbs is what says the process is alive.
    const clock = clockAt();
    const tick = ticker(true, clock);

    tick.on({ phase: 'sending', bytes: 8_081_920 });
    clock.at = 12_000;
    clock.beat();
    clock.at = 30_000;
    clock.beat();

    expect(tick.written.at(-1)).toContain('sending 7893 KiB — 30s');
  });

  it('stops the heartbeat before anything else is written', () => {
    // A timer still redrawing under an error would write over the error, which
    // is the one message here that must arrive whole.
    const clock = clockAt();
    const tick = ticker(true, clock);

    tick.on({ phase: 'sending', bytes: 1024 });
    tick.done();
    const after = tick.written.length;
    clock.beat();

    expect(tick.written).toHaveLength(after);
  });

  it('counts a long push in minutes, because nobody reads 154s', () => {
    const clock = clockAt();
    const tick = ticker(true, clock);

    tick.on({ phase: 'sending', bytes: 1024 });
    clock.at = 154_000;
    clock.beat();

    expect(tick.written.at(-1)).toContain('2m 34s');
  });

  it('says how long the whole push took, on the line the operator keeps', () => {
    // A tick scrolls past; the report is what stays. Comparing today's push
    // against yesterday's is the only way a duration means anything.
    const result: PushResult = {
      build: 'ci-1',
      endpoint: 'https://review.example',
      service: { known: true, api: 2 },
      elapsedMs: 41_400,
      subjects: 21,
      images: { after: 21, before: 17 },
      reused: 0,
      bytes: 8_081_920,
      withheld: [],
    };

    expect(formatPush(result)).toContain('in 41.4s');
  });

  it('names both versions on the line the operator keeps', () => {
    // The whole of the mismatch, in one line that survives the push. A log that
    // says only what was uploaded cannot be read six weeks later against a
    // deployment nobody remembers redeploying.
    const result = (api: number | undefined): PushResult => ({
      build: 'ci-1',
      endpoint: 'https://review.example',
      service: api === undefined ? { known: false, because: 'it answered 404' } : { known: true, api },
      elapsedMs: 1000,
      subjects: 1,
      images: { after: 1, before: 0 },
      reused: 0,
      bytes: 10,
      withheld: [],
    });

    expect(formatPush(result(2))).toContain('to a deployment serving API 2');
    // And a deployment that would not say is reported as not having said,
    // rather than as an API version of zero.
    expect(formatPush(result(undefined))).toContain('an API version it did not state');
  });
});
