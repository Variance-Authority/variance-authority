// compass: variance-authority.reach.story
/**
 * How notes reach a realm's story tap: what its frameworks announce, what its
 * console prints, and what each test line changed on its page. See
 * [`story-tap.cts`](story-tap.cts), whose {@link Tap.note} each line becomes.
 */

import util = require('node:util');
import jestConsole = require('./jest-console.cjs');
import type storyTap = require('./story-tap.cjs');

type Tap = ReturnType<typeof storyTap.createTap>;

/** Where the realm's story listens for notes; `@variance-authority/event` and `eyes` mirror it. */
const NOTE = Symbol.for('variance-authority.story.note');

/** The console methods a case prints with; each line is a note, and still printed. */
const PRINTS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** A line of text, or a template's strings and the values between them. */
type Channel = (text: string | readonly string[], ...values: unknown[]) => void;

/** The part of a DOM `MutationRecord` a page note counts. */
interface Change {
  readonly type: string;
  readonly addedNodes: { readonly length: number };
  readonly removedNodes: { readonly length: number };
}

interface Observer {
  observe(target: object, options: object): void;
  takeRecords(): Change[];
}

type Realm = {
  [NOTE]?: Channel;
  console?: Console;
  document?: object;
  MutationObserver?: new (seen: (changes: Change[]) => void) => Observer;
};

/**
 * Watch the realm's document, once, and have `tap` say what each test line
 * changed on it when the line ends, as `page +N −M nodes, A attributes, T text`.
 * A hook's line and a case's settling close the watch until a test line opens.
 * Self-contained: a page's tape puts its source on the page.
 */
function watchPage(tap: Pick<Tap, 'note' | 'drainWith'>, global: Realm): void {
  const { document, MutationObserver: Watch } = global;
  if (document === undefined || typeof Watch !== 'function') return;
  // Where a document keeps the one watch a story put on it.
  const PAGE = Symbol.for('variance-authority.story.page-watch');
  type Watching = {
    tap: Pick<Tap, 'note'>;
    observer: Observer;
    observing: boolean;
    quiet: boolean;
    // What the open test line has changed so far: nodes added and removed, attributes, text.
    counts: [number, number, number, number];
  };
  const page = document as { [PAGE]?: Watching };
  const count = (watching: Watching, changes: readonly Change[]): void => {
    if (watching.quiet) return;
    const counts = watching.counts;
    for (const change of changes) {
      if (change.type === 'attributes') counts[2] += 1;
      else if (change.type === 'characterData') counts[3] += 1;
      else {
        counts[0] += change.addedNodes.length;
        counts[1] += change.removedNodes.length;
      }
    }
  };
  let watch = page[PAGE];
  if (watch === undefined) {
    const made: Partial<Watching> & Omit<Watching, 'observer'> = { tap, observing: false, quiet: true, counts: [0, 0, 0, 0] };
    made.observer = new Watch((changes) => count(made as Watching, changes));
    watch = made as Watching;
    Object.defineProperty(page, PAGE, { value: watch });
  } else watch.tap = tap;
  const held = watch;
  tap.drainWith((opens) => {
    if (held.observing) count(held, held.observer.takeRecords());
    const [added, removed, attributes, text] = held.counts;
    if (added + removed + attributes + text > 0) {
      held.tap.note(`page +${added} −${removed} nodes, ${attributes} ${attributes === 1 ? 'attribute' : 'attributes'}, ${text} text`);
    }
    held.counts = [0, 0, 0, 0];
    held.quiet = !opens;
    // Observed from the first test line on, which a runner whose lines run
    // outside the page opens at its drain: what came before is no line's.
    if (opens && !held.observing) {
      held.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      held.observing = true;
    }
  });
}

/**
 * Have `scope`'s announcements, attention, console lines and page changes put
 * on `tap`, and its frameworks name the objects `tap` is handed.
 *
 * The channel is replaced on every call, so a realm that makes a second
 * collector notes onto the tap it uses now. The console is wrapped once: the
 * wrapper looks the channel up when a line is printed, never when it is made.
 */
function listen(tap: Pick<Tap, 'note' | 'say' | 'nameIn' | 'drainWith'>, scope: object): void {
  const global = scope as Realm;
  global[NOTE] = (text: string | readonly string[], ...values: unknown[]): void =>
    Array.isArray(text) ? tap.say(text, values) : tap.note(String(text));
  tap.nameIn(scope);
  watchPage(tap, global);
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

export = { listen, watchPage };
