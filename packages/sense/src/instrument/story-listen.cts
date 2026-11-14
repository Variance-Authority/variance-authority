// compass: variance-authority.reach.story
/**
 * How notes reach a realm's story tap: what its frameworks announce and what
 * its console prints. See [`story-tap.cts`](story-tap.cts), whose
 * {@link Tap.note} each line becomes.
 */

import util = require('node:util');
import jestConsole = require('./jest-console.cjs');
import type storyTap = require('./story-tap.cjs');

type Tap = ReturnType<typeof storyTap.createTap>;

/** Where the realm's story listens for notes; `@variance-authority/event` and `eyes` mirror it. */
const NOTE = Symbol.for('variance-authority.story.note');

/** The console methods a case prints with; each line is a note, and still printed. */
const PRINTS = ['log', 'info', 'warn', 'error', 'debug'] as const;

type Channel = (text: string) => void;

/**
 * Have `scope`'s announcements, attention and console lines put on `tap`,
 * and its frameworks name the objects `tap` is handed.
 *
 * The channel is replaced on every call, so a realm that makes a second
 * collector notes onto the tap it uses now. The console is wrapped once: the
 * wrapper looks the channel up when a line is printed, never when it is made.
 */
function listen(tap: Pick<Tap, 'note' | 'nameIn'>, scope: object): void {
  const global = scope as { [NOTE]?: Channel; console?: Console };
  global[NOTE] = (text: string): void => tap.note(String(text));
  tap.nameIn(scope);
  const printer = global.console as (Console & { [NOTE]?: true }) | undefined;
  if (printer === undefined || printer[NOTE] === true) return;
  Object.defineProperty(printer, NOTE, { value: true });
  const written = (method: string, text: string): void => {
    const channel = global[NOTE];
    if (typeof channel === 'function' && (PRINTS as readonly string[]).includes(method)) channel(`console.${method} ${text}`);
  };
  if (jestConsole.noteWrites(printer, written)) return;
  for (const method of PRINTS) {
    const original = printer[method] as ((...values: unknown[]) => void) | undefined;
    if (typeof original !== 'function') continue;
    printer[method] = function (this: unknown, ...values: unknown[]): void {
      const channel = global[NOTE];
      if (typeof channel === 'function') {
        try {
          channel(`console.${method} ${util.format(...values)}`);
        } catch {
          // A value whose inspection throws is still printed below.
        }
      }
      original.apply(this, values);
    };
  }
}

export = { listen };
