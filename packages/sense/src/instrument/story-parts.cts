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
// The bytes a part's notes take in the story's JSON, with each one's place
// and key: with its visits and their rows, base64 keeps the telling under the
// watcher's 1 MiB whatever script a note is written in.
const PART_NOTE_BYTES = 384 << 10;
const utf8 = new TextEncoder();
const encodedLength = (line: string): number => 12 + utf8.encode(JSON.stringify(line)).length;

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
  // Whether the realm wrote to another bucket's part since this one's last visit.
  left: boolean;
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
  /** Whether `into` has room for a note of `kind`, counting the note as said or as lost. */
  room(into: Part, kind: 'spoken' | 'handed'): boolean;
  /** Put `line` in the part now, while its notes' bytes allow. */
  note(line: string): void;
  /** The part of bucket `key` since it was last taken, and let go of. */
  take(key: string): Taken | undefined;
  /** How many visits and notes the parts not yet taken hold. */
  holding(): { visits: number; notes: number };
}

/**
 * Parts in front of `engine`, each keeping at most `limit` visits.
 *
 * A part left for another bucket's work and resumed says so with an empty
 * segment of nobody's, so its story counts the interleaving as a whole tape's
 * would.
 */
function createParts(engine: Engine, limit: number): Parts {
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
      found = { tape: [], at: [], keys: [], visits: 0, notes: [], unnoted: 0, spoken: 0, handed: 0, bytes: 0, left: false };
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
        // A full part is counted, and its segments no longer grow with uptime.
        if (part.tape.length < limit) {
          const resumed = part.left && part.at.length > 0;
          part.at.push(...Array<number>(resumed ? 2 : 1).fill(part.tape.length));
          part.keys.push(...(resumed ? ['\u0000elsewhere', key] : [key]));
          part.left = false;
        }
      }
      if (part === undefined) return;
      part.visits += 1;
      if (part.tape.length >= limit) return;
      part.tape.push(entry);
      open += 1;
    },
    room(into: Part, kind: 'spoken' | 'handed'): boolean {
      if (into[kind] >= PART_NOTES) {
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
      if (into.bytes + bytes > PART_NOTE_BYTES) {
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
