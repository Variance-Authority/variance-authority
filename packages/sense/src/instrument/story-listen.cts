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

type Channel = (text: string) => void;

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
 * Watch the realm's document, once, and have `tap` say what changed on it at
 * each test line, as `page +N −M nodes, A attributes, T text`: drained when
 * the line ends, so a change lands on the line that made it, and said by the
 * observer for what an `await` let through. What runs before a case's first
 * line and after its body, its hooks and their cleanup, is no line's: a hook's
 * line or the case's settling closes the watch until the next test line opens.
 * A later call moves the watch to the tap it is given.
 *
 * Self-contained: a page's tape puts its source on the page, as it does
 * `createTap`'s.
 */
function watchPage(tap: Pick<Tap, 'note' | 'drainWith'>, global: Realm): void {
  const { document, MutationObserver: Watch } = global;
  if (document === undefined || typeof Watch !== 'function') return;
  // Where a document keeps the one watch a story put on it.
  const PAGE = Symbol.for('variance-authority.story.page-watch');
  type Watching = { tap: Pick<Tap, 'note'>; observer: Observer; quiet: boolean };
  const page = document as { [PAGE]?: Watching };
  // One line for what changed: nodes added and removed, attributes, and text.
  const say = (watching: Watching, changes: readonly Change[]): void => {
    if (changes.length === 0 || watching.quiet) return;
    let added = 0;
    let removed = 0;
    let attributes = 0;
    let text = 0;
    for (const change of changes) {
      if (change.type === 'attributes') attributes += 1;
      else if (change.type === 'characterData') text += 1;
      else {
        added += change.addedNodes.length;
        removed += change.removedNodes.length;
      }
    }
    watching.tap.note(`page +${added} −${removed} nodes, ${attributes} ${attributes === 1 ? 'attribute' : 'attributes'}, ${text} text`);
  };
  let watch = page[PAGE];
  if (watch === undefined) {
    const made: Partial<Watching> & Pick<Watching, 'tap' | 'quiet'> = { tap, quiet: true };
    made.observer = new Watch((changes) => say(made as Watching, changes));
    made.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    watch = made as Watching;
    Object.defineProperty(page, PAGE, { value: watch });
  } else watch.tap = tap;
  const held = watch;
  tap.drainWith((ending) => {
    say(held, held.observer.takeRecords());
    held.quiet = ending !== 'line';
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
function listen(tap: Pick<Tap, 'note' | 'nameIn' | 'drainWith'>, scope: object): void {
  const global = scope as Realm;
  global[NOTE] = (text: string): void => tap.note(String(text));
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
