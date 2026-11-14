// compass: variance-authority.reach.story
/**
 * A live tap's parts: what each execution of a running head visited and was
 * handed, kept apart by bucket until the execution is told. See
 * [`story-tap.cts`](story-tap.cts), whose `live` switch keeps them, and whose
 * `take` hands one over.
 *
 * A head that serves for weeks is never idle, so a whole tape would grow with
 * uptime. A part holds one execution, is let go of once told, and is bounded
 * on its own: one chatty execution, or the process's own work, never silences
 * another.
 */

import type storyFormat = require('../story/format.cjs');

/** What a part reads of the engine: the activation, the async scope, and the bucket now. */
interface Engine {
  readonly root: { readonly a: number; readonly s: (() => void) | null };
  current(): { readonly key: string };
}

/**
 * How many visits, and notes of each kind, one execution's part keeps: told,
 * it fits the 1 MiB a watcher keeps of an execution.
 */
const PART_LIMIT = 1 << 16;
const PART_NOTES = 1024;
// The bytes a part's notes and the rows of the modules it entered take in the
// story's JSON, a note with its place and key, a row with its count: with the
// visits, base64 keeps the telling under the watcher's 1 MiB whatever script a
// note is written in and however many modules the execution entered.
const PART_TEXT_BYTES = 384 << 10;
// Counted by hand: a jsdom suite's realm loads this module and has no `TextEncoder`.
const utf8Length = (text: string): number => {
  let bytes = text.length;
  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);
    // Two units of a pair are four bytes, each other unit past ASCII two or three.
    if (unit >= 0xd800 && unit <= 0xdbff && at + 1 < text.length && (text.charCodeAt(at + 1) & 0xfc00) === 0xdc00) {
      bytes += 2;
      at += 1;
    } else if (unit >= 0x80) bytes += unit >= 0x800 ? 2 : 1;
  }
  return bytes;
};
const encodedLength = (text: string): number => 12 + utf8Length(JSON.stringify(text));

interface Part {
  tape: number[];
  at: number[];
  keys: string[];
  visits: number;
  notes: [number, string, string][];
  unnoted: number;
  spoken: number;
  handed: number;
  bytes: number;
  // The rows of the modules it entered, which its story's header names.
  modules: Set<number>;
  // Whether the realm wrote to another bucket's part since this one's last visit.
  left: boolean;
  // The key of the segment its next kept visit opens, when the realm activated it since.
  opening: string | undefined;
  // Whether its last visit was not kept, so a note said now has no step to stand under.
  dropped: boolean;
}

/** One execution's part, as {@link Parts.take} hands it over. */
interface Taken {
  readonly tape: Int32Array;
  readonly visits: number;
  readonly at: readonly number[];
  readonly keys: readonly string[];
  readonly notes: readonly (readonly [at: number, key: string, text: string])[];
  readonly unnoted: number;
}

interface Parts {
  /** The part the realm writes to now, after its async scope has said; none for idle work. */
  here(): Part | undefined;
  /** Tape a visit into the part of the bucket now, counting what is past its limit. */
  tape(entry: number): void;
  /** Whether `into` has room for a note of `kind`, and kept the visit it would stand under, counting the note as said or as lost. */
  room(into: Part, kind: 'spoken' | 'handed'): boolean;
  /** Put `line` in the part now, while its notes' bytes allow. */
  note(line: string): void;
  /** The part of bucket `key` since it was last taken, and let go of. */
  take(key: string): Taken | undefined;
  /** How many visits and notes the parts not yet taken hold. */
  holding(): { visits: number; notes: number };
}

/** The modules a realm registered: each one's id, and the index its regions start at. */
interface Rows {
  readonly ids: readonly string[];
  readonly bases: readonly number[];
}

/**
 * Parts in front of `engine`, each keeping at most `limit` visits, and a visit
 * to a module of `rows` only while the module's row fits its text.
 *
 * A part left for another bucket's work and resumed says so with an empty
 * segment of nobody's, so its story counts the interleaving as a whole tape's
 * would.
 */
function createParts(engine: Engine, limit: number, rows: Rows): Parts {
  // The format places a visit in its module's row; loaded here, as only a live tap makes parts.
  const { rowAt } = require('../story/format.cjs') as typeof storyFormat;
  const inner = engine.root;
  const parts = new Map<string, Part>();
  // The part the realm writes to now, and the last one it wrote to that was not idle.
  let part: Part | undefined;
  let last: Part | undefined;
  let open = 0;
  let seen = -1;
  const partOf = (key: string): Part | undefined => {
    if (key === '') return undefined;
    let found = parts.get(key);
    if (found === undefined) {
      found = { tape: [], at: [], keys: [], visits: 0, notes: [], unnoted: 0, spoken: 0, handed: 0, bytes: 0, modules: new Set(), left: false, opening: undefined, dropped: false };
      parts.set(key, found);
    }
    return found;
  };
  const here = (): Part | undefined => {
    inner.s?.();
    return partOf(engine.current().key);
  };

  return {
    here,
    tape(entry: number): void {
      if (inner.a !== seen) {
        seen = inner.a;
        const key = engine.current().key;
        part = partOf(key);
        if (part === undefined) return;
        if (last !== undefined && last !== part) last.left = true;
        last = part;
        part.opening = key;
      }
      if (part === undefined) return;
      part.visits += 1;
      part.dropped = true;
      if (part.tape.length >= limit) return;
      const row = rowAt(rows.bases, entry & 0x7fffffff);
      if (!part.modules.has(row)) {
        // A row is its id, a count of at most ten digits, two brackets and two commas.
        const bytes = encodedLength(rows.ids[row]!) + 2;
        if (part.bytes + bytes > PART_TEXT_BYTES) return;
        part.bytes += bytes;
        part.modules.add(row);
      }
      // A segment opens with the first visit kept, so a part keeping none no longer grows with uptime.
      if (part.opening !== undefined) {
        const resumed = part.left && part.at.length > 0;
        part.at.push(...Array<number>(resumed ? 2 : 1).fill(part.tape.length));
        part.keys.push(...(resumed ? ['\u0000elsewhere', part.opening] : [part.opening]));
        part.left = false;
        part.opening = undefined;
      }
      part.tape.push(entry);
      part.dropped = false;
      open += 1;
    },
    room(into: Part, kind: 'spoken' | 'handed'): boolean {
      if (into.dropped || into[kind] >= PART_NOTES) {
        into.unnoted += 1;
        return false;
      }
      into[kind] += 1;
      return true;
    },
    note(line: string): void {
      const into = here();
      if (into === undefined) return;
      const bytes = encodedLength(line);
      if (into.bytes + bytes > PART_TEXT_BYTES) {
        into.unnoted += 1;
        return;
      }
      into.bytes += bytes;
      into.notes.push([into.tape.length, engine.current().key, line]);
    },
    take(key: string): Taken | undefined {
      const taken = parts.get(key);
      parts.delete(key);
      if (taken === part) [part, seen] = [undefined, -1];
      if (taken === last) last = undefined;
      if (taken === undefined) return undefined;
      open -= taken.tape.length;
      const { tape, at, keys, visits, notes, unnoted } = taken;
      return { tape: Int32Array.from(tape), visits, at, keys, notes, unnoted };
    },
    holding() {
      let notes = 0;
      for (const taken of parts.values()) notes += taken.notes.length;
      return { visits: open, notes };
    },
  };
}

export = { createParts, PART_LIMIT, PART_NOTES };
