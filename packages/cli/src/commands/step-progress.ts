import { readFileSync } from 'node:fs';
import type { Progress } from '@variance-authority/sense';
import { REAL, seconds, wholeSeconds, type TickerClock } from './ticker-clock.js';

/**
 * The steps of a long command, as a terminal shows them and as a log records them.
 *
 * `variance index` on a large checkout is tens of seconds of git, manifests, a
 * native read and a publish, and each of them is silent. The person waiting
 * needs two things from it: that the process is alive, and which step is slow.
 * So a step is named when it starts and timed when it ends.
 *
 * A terminal keeps the running step on one line rewritten in place, with a
 * clock that climbs every second, and leaves each finished step above it with
 * its duration. A log gets one line when a step starts and one when it ends,
 * and nothing in between: it is read after the fact, where the question is
 * which step took the time. Both go to stderr, because stdout is the answer a
 * pipeline parses.
 *
 * Steps overlap, because the follow-ups of `variance index` run at once: the
 * line names the newest and counts the rest.
 */
export function stepTicker(
  write: (text: string) => void,
  tty: boolean,
  clock: TickerClock = REAL,
): { readonly progress: Progress; readonly done: () => void } {
  const running: { readonly step: string; readonly at: number }[] = [];
  let width = 0;
  let stop: (() => void) | undefined;

  const line = (text: string): void => {
    // Padded to the widest line so far, or the tail of a longer line survives
    // the carriage return.
    write(`\r${text.padEnd(width)}`);
    width = Math.max(width, text.length);
  };

  const draw = (): void => {
    const newest = running.at(-1);
    if (newest === undefined) return;
    const more = running.length > 1 ? `, and ${String(running.length - 1)} more` : '';
    line(`  ${newest.step}${more} — ${wholeSeconds(clock.now() - newest.at)}`);
  };

  const halt = (): void => {
    stop?.();
    stop = undefined;
  };

  const progress: Progress = (step) => {
    const held = { step, at: clock.now() };
    running.push(held);
    if (!tty) write(`  ${step}\n`);
    else {
      draw();
      stop ??= clock.every(1000, draw);
    }
    return () => {
      const at = running.indexOf(held);
      if (at === -1) return;
      running.splice(at, 1);
      const took = `  ${step} — ${seconds(clock.now() - held.at)}`;
      if (!tty) {
        write(`${took}\n`);
        return;
      }
      // Kept on the screen: once the command is over, these lines are the answer
      // to which step was slow.
      write(`\r${took.padEnd(width)}\n`);
      width = 0;
      if (running.length === 0) halt();
      else draw();
    };
  };

  return {
    progress,
    // Called whatever the command did, including when it threw: an error printed
    // onto a half-written line is the one message that must arrive whole.
    done: () => {
      halt();
      if (tty && width > 0) write(`\r${''.padEnd(width)}\r`);
      width = 0;
    },
  };
}

/**
 * While this process waits on another, its latest line, redrawn every second on
 * a terminal with how long this one has waited.
 *
 * The process making the follow-ups writes its steps to `log`, and a command
 * that waits on it said so once. Without this the terminal then sits still for
 * as long as the follow-ups take, which reads the same as a hung process. The log
 * is read again on each beat; it holds a few lines per step, so the read is
 * nothing beside the second it fills. Returns the call that stops it and takes
 * the line back.
 */
export function logHeartbeat(log: string, write: (text: string) => void, clock: TickerClock = REAL): () => void {
  const started = clock.now();
  let width = 0;
  const beat = (): void => {
    let text: string;
    try {
      text = readFileSync(log, 'utf8');
    } catch {
      return;
    }
    const last = text.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '').at(-1);
    if (last === undefined) return;
    const shown = `${last.startsWith('  ') ? '' : '  '}${last} — waited ${wholeSeconds(clock.now() - started)}`;
    write(`\r${shown.padEnd(width)}`);
    width = Math.max(width, shown.length);
  };
  const stop = clock.every(1000, beat);
  return () => {
    stop();
    if (width > 0) write(`\r${''.padEnd(width)}\r`);
  };
}
