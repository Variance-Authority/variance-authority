import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logHeartbeat, stepTicker } from './step-progress.js';
import type { TickerClock } from './ticker-clock.js';

/**
 * What `variance index` says while it works.
 *
 * On a large checkout the index is tens of seconds of git, manifests, a native
 * read and a publish, and before this it printed nothing until it was over. The
 * person waiting could not tell a slow step from a hung one, nor which step was
 * slow. So every assertion here is about a line arriving: the step that is
 * running, a clock that climbs while it runs, and how long it took once it is over.
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

function ticker(tty: boolean, clock: TickerClock) {
  const written: string[] = [];
  return { written, ...stepTicker((text) => written.push(text), tty, clock) };
}

describe('the steps of an index, as a log records them', () => {
  it('writes one line when a step starts and one with its duration when it ends', () => {
    const clock = clockAt();
    const tick = ticker(false, clock);
    const ended = tick.progress('listing /repo with git');
    clock.at = 5100;
    ended();
    tick.done();

    expect(tick.written).toEqual([
      '  listing /repo with git\n',
      '  listing /repo with git — 5.1s\n',
    ]);
  });

  it('never redraws: a log is read after the fact, where a line per second is a wall', () => {
    const clock = clockAt();
    const tick = ticker(false, clock);
    tick.progress('publishing the questions');
    clock.at = 3000;
    clock.beat();

    expect(tick.written).toEqual(['  publishing the questions\n']);
  });
});

describe('the steps of an index, as a terminal shows them', () => {
  it('keeps the running step on one line, with a clock that climbs while it runs', () => {
    const clock = clockAt();
    const tick = ticker(true, clock);
    tick.progress('listing /repo with git');
    clock.at = 2000;
    clock.beat();

    expect(tick.written.every((text) => !text.includes('\n'))).toBe(true);
    expect(tick.written.at(-1)).toContain('listing /repo with git — 2s');
  });

  it('leaves each finished step on the screen with how long it took', () => {
    const clock = clockAt();
    const tick = ticker(true, clock);
    const ended = tick.progress('listing /repo with git');
    clock.at = 5100;
    ended();
    tick.done();

    const kept = tick.written.join('').split('\n').map((line) => (line.split('\r').at(-1) ?? '').trimEnd());
    expect(kept).toContain('  listing /repo with git — 5.1s');
    // The cursor is left on an empty line for whatever prints next.
    expect(tick.written.join('')).toMatch(/(\n|\r *\r)$/);
  });

  it('names how many more steps run beside the newest, since the follow-ups run at once', () => {
    const clock = clockAt();
    const tick = ticker(true, clock);
    tick.progress('writing the code map');
    tick.progress('writing the journeys');

    expect(tick.written.at(-1)).toContain('writing the journeys, and 1 more — 0s');
  });

  it('stops the heartbeat when nothing is running, so it cannot write over what prints next', () => {
    const clock = clockAt();
    const tick = ticker(true, clock);
    const ended = tick.progress('writing the code map');
    ended();
    const count = tick.written.length;
    clock.at = 9000;
    clock.beat();

    expect(tick.written).toHaveLength(count);
  });
});

describe('waiting on another process, as a terminal shows it', () => {
  it("redraws the other process's latest line every second, with how long this one has waited", () => {
    const log = join(mkdtempSync(join(tmpdir(), 'va-heartbeat-')), 'follow-ups.log');
    writeFileSync(log, '  writing the code map\n  writing the questions\n');
    const clock = clockAt();
    const written: string[] = [];
    const stop = logHeartbeat(log, (text) => written.push(text), clock);
    clock.at = 3000;
    clock.beat();
    writeFileSync(log, '  writing the code map\n  writing the questions\n  writing the code map — 1.0s\n');
    clock.at = 4000;
    clock.beat();
    stop();

    expect(written[0]).toBe('\r  writing the questions — waited 3s');
    expect(written[1]).toContain('writing the code map — 1.0s — waited 4s');
    // Stopped, the line is taken back, so the command's own output starts clean.
    expect(written.at(-1)).toMatch(/^\r *\r$/);
  });

  it('says nothing about a log that is not there yet', () => {
    const clock = clockAt();
    const written: string[] = [];
    const stop = logHeartbeat(join(tmpdir(), 'va-heartbeat-absent', 'follow-ups.log'), (text) => written.push(text), clock);
    clock.at = 1000;
    clock.beat();
    stop();

    expect(written).toEqual([]);
  });
});
