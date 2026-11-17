// compass: variance-authority.reach.story
/**
 * What the browser reports of a page's frames, put on its story where it
 * happened: the first paint, each largest paint, each move of the layout, and
 * each frame a script held past 50 ms. The browser reports a frame after it
 * ends, so each note is placed by the time the browser gives it, through
 * {@link Tap.noteAt}. Its durations and scores change from run to run, so a
 * comparison of readings leaves these notes out: see {@link fromFrames}.
 */

import type storyTap = require('./story-tap.cjs');

type Tap = ReturnType<typeof storyTap.createTap>;

/** The part of a `PerformanceEntry` a note reads, of the four types watched. */
interface Entry {
  readonly entryType: string;
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly renderTime?: number;
  readonly element?: { readonly localName: string; readonly id: string; readonly classList: { readonly [index: number]: string } } | null;
  readonly value?: number;
  readonly scripts?: readonly { readonly startTime: number; readonly duration: number }[];
}

interface Observer {
  observe(options: object): void;
  takeRecords(): Entry[];
}

type Realm = {
  performance?: { now(): number };
  PerformanceObserver?: (new (seen: (list: { getEntries(): Entry[] }) => void) => Observer) & { readonly supportedEntryTypes?: readonly string[] };
};

/**
 * Watch the realm's frames, once, and have `tap` place what the browser
 * reports of them, and say which of the four types this browser never
 * reports. Answers what puts the reports not yet delivered on the tape now.
 * Self-contained: a page's tape puts its source on the page.
 */
function watchFrames(tap: Pick<Tap, 'note' | 'noteAt' | 'stampWith'>, global: object): () => void {
  const { performance: clock, PerformanceObserver: Watch } = global as Realm;
  const supported = Watch?.supportedEntryTypes;
  if (clock === undefined || typeof Watch !== 'function' || supported === undefined || !supported.includes('paint')) return () => {};
  const WATCH = Symbol.for('variance-authority.story.frame-watch');
  const realm = global as { [WATCH]?: { tap: Pick<Tap, 'noteAt'>; flush: () => void } };
  tap.stampWith(() => clock.now());
  const known = realm[WATCH];
  if (known !== undefined) {
    known.tap = tap;
    return known.flush;
  }
  const types = ['paint', 'largest-contentful-paint', 'layout-shift', 'long-animation-frame'];
  const unseen = types.filter((type) => !supported.includes(type));
  if (unseen.length > 0) tap.note(`unseen here: ${unseen.join(', ')}`);
  const nameOf = ({ localName, id, classList }: NonNullable<Entry['element']>): string =>
    id !== '' ? `${localName}#${id}` : classList[0] !== undefined ? `${localName}.${classList[0]}` : localName;
  // Each report as its time and its note; a held frame is placed after the script that held it longest.
  const told = (entry: Entry): [number, string] | undefined => {
    if (entry.entryType === 'paint') return entry.name === 'first-paint' ? [entry.startTime, 'first paint'] : undefined;
    if (entry.entryType === 'largest-contentful-paint') {
      const at = entry.renderTime !== undefined && entry.renderTime > 0 ? entry.renderTime : entry.startTime;
      return [at, entry.element ? `largest paint: ${nameOf(entry.element)}` : 'largest paint'];
    }
    if (entry.entryType === 'layout-shift') {
      const value = entry.value ?? 0;
      return [entry.startTime, `layout moved ${value < 0.01 ? '<0.01' : value.toFixed(2)}`];
    }
    if (entry.entryType !== 'long-animation-frame') return undefined;
    const longest = (entry.scripts ?? []).reduce<{ startTime: number; duration: number } | undefined>((most, script) => (most === undefined || script.duration > most.duration ? script : most), undefined);
    const end = longest === undefined ? entry.startTime + entry.duration : longest.startTime + longest.duration;
    return [end, `held a frame (${Math.round(entry.duration)} ms)`];
  };
  const hear = (entries: readonly Entry[]): void => {
    const notes = entries.flatMap((entry) => {
      const note = told(entry);
      return note === undefined ? [] : [note];
    });
    notes.sort((a, b) => a[0] - b[0]);
    for (const [at, text] of notes) watching.tap.noteAt(at, text);
  };
  const observer = new Watch((list) => hear(list.getEntries()));
  const watching = { tap: tap as Pick<Tap, 'noteAt'>, flush: () => hear(observer.takeRecords()) };
  Object.defineProperty(realm, WATCH, { value: watching });
  for (const type of types) if (supported.includes(type)) observer.observe({ type, buffered: true });
  return watching.flush;
}

/** Whether a note is one {@link watchFrames} put on a tape, whose text and place are the browser's timing. */
function fromFrames(note: string): boolean {
  return /^(first paint$|largest paint(: |$)|layout moved |held a frame \(|unseen here: )/.test(note);
}

export = { watchFrames, fromFrames };
