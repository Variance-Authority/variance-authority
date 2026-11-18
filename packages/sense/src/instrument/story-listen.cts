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

/** The part of a DOM node a change line names. */
interface Seen {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly childNodes?: ArrayLike<Seen>;
  readonly parentNode: Seen | null;
  getAttribute?(name: string): string | null;
  querySelectorAll?(selector: string): ArrayLike<Seen>;
}

/** The part of a DOM `MutationRecord` a page note reads. */
interface Change {
  readonly type: string;
  readonly target: Seen;
  readonly attributeName: string | null;
  readonly oldValue: string | null;
  readonly addedNodes: ArrayLike<Seen>;
  readonly removedNodes: ArrayLike<Seen>;
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
 * Watch the realm's document, once, and have `tap` write each change a test
 * line made to it as one line, then say what the line changed when it ends, as
 * `page +N −M nodes, A attributes, T text`. A change is `dom` and its kind —
 * `+`, `−`, `@attribute old→new`, `text old→new` — then the node as the page
 * states it: its tag, id, `role` and label or text, never a role computed from
 * its tag, and the component that owns it where React names one. A node added
 * or removed brings a line for each node inside it a search could name.
 * Where React tells the realm of each commit, what the commit changed is written
 * as it lands, with the commit's ordinal in the case. What a field holds, as a
 * value or a password, is never written.
 *
 * A hook's line and a case's settling close the watch until a test line opens.
 * Self-contained: a page's tape puts its source on the page.
 */
function watchPage(tap: Pick<Tap, 'note' | 'notePage' | 'drainWith'>, global: Realm): void {
  const { document, MutationObserver: Watch } = global;
  if (document === undefined || typeof Watch !== 'function') return;
  // Where a document keeps the one watch a story put on it.
  const PAGE = Symbol.for('variance-authority.story.page-watch');
  // Where a framework calls when it commits to the page, and where it names the component that owns a node.
  const COMMIT = Symbol.for('variance-authority.story.page-commit');
  const OWNER = Symbol.for('variance-authority.story.page-owner');
  // How many characters of a name or a value a change line keeps.
  const SHOWN = 80;
  // Fields whose text and value are what a person typed.
  const FIELDS = new Set(['input', 'select', 'textarea']);
  type Watching = {
    tap: Pick<Tap, 'note' | 'notePage'>;
    observer: Observer;
    observing: boolean;
    quiet: boolean;
    // The commits the open case has made so far.
    commits: number;
    // What the open test line has changed so far: nodes added and removed, attributes, text.
    counts: [number, number, number, number];
  };
  const page = document as { [PAGE]?: Watching };
  const shown = (text: string): string => {
    const line = text.replace(/\s+/g, ' ').trim();
    return JSON.stringify(line.length > SHOWN ? `${line.slice(0, SHOWN - 1)}…` : line);
  };
  const tagOf = (node: Seen): string => node.nodeName.toLowerCase();
  // The text inside a node, leaving out what a field inside it holds.
  const textOf = (node: Seen): string =>
    node.nodeType === 3
      ? node.nodeValue ?? ''
      : FIELDS.has(tagOf(node))
        ? ''
        : Array.from(node.childNodes ?? [], textOf).join('');
  const nameOf = (node: Seen): string | undefined => {
    const given = node.getAttribute?.('aria-label') ?? node.getAttribute?.('alt') ?? node.getAttribute?.('title');
    if (given) return given;
    if (FIELDS.has(tagOf(node))) return undefined;
    const text = textOf(node).trim();
    return text ? text : undefined;
  };
  // The node as a line names it: its tag, id, type, role and, where asked, its name.
  // A text node is read under `parent`, the node a change put it in or took it from: one taken away has none of its own.
  const described = (node: Seen, named = true, parent: Seen | null = node.parentNode): string | undefined => {
    if (node.nodeType === 3) {
      const text = node.nodeValue?.trim();
      return text && !FIELDS.has(parent === null ? '' : tagOf(parent)) ? `text ${shown(text)}` : undefined;
    }
    if (node.nodeType !== 1) return undefined;
    const tag = tagOf(node);
    const id = node.getAttribute?.('id');
    const type = tag === 'input' ? node.getAttribute?.('type') : null;
    const role = node.getAttribute?.('role');
    const name = named ? nameOf(node) : undefined;
    return [tag, id && `id=${shown(id)}`, type && `type=${shown(type)}`, role && `role=${shown(role)}`, name && shown(name)]
      .filter(Boolean)
      .join(' ');
  };
  // Whether a search could name the node: a role, an id or a label it says, or a text of its own.
  const findable = (node: Seen): boolean =>
    Boolean(node.getAttribute?.('role') || node.getAttribute?.('id') || node.getAttribute?.('aria-label')) ||
    Array.from(node.childNodes ?? []).some((inner) => inner.nodeType === 3 && Boolean(inner.nodeValue?.trim()));
  const owner = (node: Seen): string => {
    const naming = (global as { [OWNER]?: unknown })[OWNER];
    const name = typeof naming === 'function' ? (naming as (node: Seen) => unknown)(node) : undefined;
    return typeof name === 'string' ? ` in ${name}` : '';
  };
  // Write what `changes` did, in the order they came, under `commit` where one made them.
  const write = (watching: Watching, changes: readonly Change[], commit?: number): void => {
    if (watching.quiet) return;
    const counts = watching.counts;
    // A line, or an attribute or text to be told once, from what it was to what it is.
    const told: (string | [node: Seen, key: string])[] = [];
    // Each node is told once per sign, so a node moved is taken away and put back, and one put in and taken out is both.
    const seen = { '+': new Set<Seen>(), '−': new Set<Seen>() };
    const was = new Map<Seen, Map<string, string | null>>();
    const tell = (sign: '+' | '−', node: Seen, parent: Seen): void => {
      const of = seen[sign];
      if (of.has(node)) return;
      of.add(node);
      const it = described(node, true, parent);
      if (it !== undefined) told.push(`dom ${sign} ${it}${owner(node)}`);
      for (const inner of Array.from(node.querySelectorAll?.('*') ?? [])) {
        if (of.has(inner) || !findable(inner)) continue;
        of.add(inner);
        told.push(`dom ${sign} ${described(inner)!}${owner(inner)}`);
      }
    };
    for (const change of changes) {
      if (change.type === 'attributes' || change.type === 'characterData') {
        counts[change.type === 'attributes' ? 2 : 3] += 1;
        const key = change.type === 'attributes' ? change.attributeName ?? '' : '';
        const of = was.get(change.target) ?? was.set(change.target, new Map()).get(change.target)!;
        if (!of.has(key)) {
          of.set(key, change.oldValue);
          told.push([change.target, key]);
        }
        continue;
      }
      counts[0] += change.addedNodes.length;
      counts[1] += change.removedNodes.length;
      for (const node of Array.from(change.removedNodes)) tell('−', node, change.target);
      for (const node of Array.from(change.addedNodes)) tell('+', node, change.target);
    }
    const at = commit === undefined ? '' : ` at commit ${commit}`;
    for (const line of told) {
      if (typeof line === 'string') {
        watching.tap.notePage(`${line}${at}`);
        continue;
      }
      const [node, key] = line;
      const old = was.get(node)!.get(key)!;
      if (key === '') {
        // Text inside a field is what a person typed; its change is counted, never written.
        const parent = node.parentNode;
        if (parent === null || FIELDS.has(tagOf(parent))) continue;
        watching.tap.notePage(`dom text ${described(parent, false)!} ${shown(old ?? '')}→${shown(node.nodeValue ?? '')}${owner(parent)}${at}`);
        continue;
      }
      const now = node.getAttribute?.(key) ?? null;
      const value = (text: string | null): string => (text === null ? 'absent' : shown(text));
      // A field's value is what a person typed, so only that it changed is written.
      const held = key === 'value' && FIELDS.has(tagOf(node));
      const change = held ? '' : ` ${value(old)}→${value(now)}`;
      watching.tap.notePage(`dom @${key} ${described(node, !FIELDS.has(tagOf(node)))!}${change}${owner(node)}${at}`);
    }
  };
  let watch = page[PAGE];
  if (watch === undefined) {
    const made: Partial<Watching> & Omit<Watching, 'observer'> = { tap, observing: false, quiet: true, commits: 0, counts: [0, 0, 0, 0] };
    made.observer = new Watch((changes) => write(made as Watching, changes));
    watch = made as Watching;
    Object.defineProperty(page, PAGE, { value: watch });
  } else watch.tap = tap;
  const held = watch;
  // A commit's changes are written as it lands, so each sits under the commit that made it.
  (global as { [COMMIT]?: () => void })[COMMIT] = (): void => {
    if (!held.observing || held.quiet) return;
    held.commits += 1;
    write(held, held.observer.takeRecords(), held.commits);
  };
  tap.drainWith((opens) => {
    if (held.observing) write(held, held.observer.takeRecords());
    const [added, removed, attributes, text] = held.counts;
    if (added + removed + attributes + text > 0) {
      held.tap.note(`page +${added} −${removed} nodes, ${attributes} ${attributes === 1 ? 'attribute' : 'attributes'}, ${text} text`);
    }
    held.counts = [0, 0, 0, 0];
    held.quiet = !opens;
    if (!opens) held.commits = 0;
    // Observed from the first test line on, which a runner whose lines run
    // outside the page opens at its drain: what came before is no line's.
    if (opens && !held.observing) {
      const options = { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true };
      held.observer.observe(document, options);
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
function listen(tap: Pick<Tap, 'note' | 'notePage' | 'nameIn' | 'drainWith'>, scope: object): void {
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
