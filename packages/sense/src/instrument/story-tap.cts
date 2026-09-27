/**
 * Every visit a realm makes, in the order it made them: the root a story is
 * read from.
 *
 * The engine in [`probe-log.cts`](probe-log.cts) answers *has this execution
 * been here*, and it is built so a probe that already answered costs two byte
 * reads. A story is a different question — *in what order* — and it is asked of
 * one case at a time, when somebody runs it with `VARIANCE_AUTHORITY_STORY=1`. So
 * it is not a mode of the engine. It is a second root in front of it, and the
 * emitted probe does not change.
 *
 * ## How the probe is made to report every hit
 *
 * The probe's side of the contract is in [`index.ts`](index.ts). It tests a
 * region's gate byte against the passing byte `p`, and skips when both are set.
 * The tap registers every module with a `p` of zero, so no hit is ever skipped
 * and every one reaches `__vaS`. There the probe appends to `L` while `n < l`,
 * and calls the slow write `g` otherwise. The tap's `n` and `l` are zero, so
 * `g` receives every hit: the region's index across the realm, with the
 * evaluating bit. `g` puts it on the tape and hands it to the engine's own `g`,
 * which logs it as a first touch and compacts the repeats away.
 *
 * What the engine reads out is therefore the read-out it would have made
 * without the tap: the same regions, the same evaluating bits, the same rows.
 * A story run records the journey it would have recorded anyway, and the tape
 * is written beside it and never into it.
 *
 * ## Why these fields are accessors here
 *
 * `a`, `s` and `v` belong to the engine, which moves them when a case opens,
 * when a scope answers another bucket, and when a module starts evaluating. The
 * tap reads them through getters. [`index.ts`](index.ts) measures an accessor on
 * the root at ten times a data field, which is why the recording never has one;
 * a story is a run somebody asked to be slower in exchange for the order.
 *
 * ## Order, and nothing that looks like structure
 *
 * The tape is the order the probes fired in, in one realm. It holds no
 * entry-and-exit brackets, no depth and no stack: an `await` resumes a function
 * in the middle of somebody else's work, and the tape shows that as it
 * happened rather than nesting it under whoever was entered last.
 *
 * ## What the code said on the way
 *
 * A visit says where the case was, never with what. {@link Tap.note} puts a line
 * of text on the tape at the place it was said — a console line, an
 * announcement, a test's own Arrange/Act/Assert marker — so the reader of a
 * route sees the value next to the step that printed it. A note is not a
 * visit: it moves no bucket and the engine never sees it.
 *
 * {@link listen} is how notes arrive. It installs one function under
 * `Symbol.for('variance-authority.story.note')` on the realm's global, which
 * `@variance-authority/event` and `@variance-authority/eyes` call when it is
 * there, and it wraps the realm's `console` so that every line the case prints
 * is also a note. The console still prints: the wrapper says the line to the
 * tape and hands it on unchanged. Both happen only in a realm that is recording
 * a story, which somebody asked for by name.
 *
 * ## Written to be sent as text
 *
 * {@link createTap} closes over everything it uses, like `createEngine`, so a
 * page collector can send its source across a bundler when a page carries
 * stories too.
 */

import util = require('node:util');
import probeLog = require('./probe-log.cjs');
import type { ModuleId } from './index.js';

type Engine = ReturnType<typeof probeLog.createEngine>;

/** What a tape holds since its last reset; see {@link Tap.read}. */
interface Tape {
  readonly tape: Int32Array;
  readonly taped: number;
  readonly visits: number;
  readonly at: readonly number[];
  readonly keys: readonly string[];
  /** Each note: how many visits were taped before it, the bucket it was said in, and the text. */
  readonly notes: readonly (readonly [at: number, key: string, text: string])[];
  /** Notes past {@link NOTE_LIMIT}, counted and not kept. */
  readonly unnoted: number;
  readonly rows: { readonly ids: readonly ModuleId[]; readonly counts: readonly number[]; readonly bases: readonly number[] };
}

interface Tap {
  /** What the realm's `__VA__` is set to. */
  readonly root: object;
  /** The engine behind it, which records presence as it would without the tap. */
  readonly engine: Engine;
  /**
   * The tape since the last reset: `taped` entries of `tape`, `visits` hits in
   * all, and at each `at[i]` the bucket `keys[i]` began. `visits` greater than
   * `taped` is a tape that stopped, never one that was empty.
   */
  read(): Tape;
  /** Put `text` on the tape where the realm is now, in the case running now. */
  note(text: string): void;
  /** Start the tape again, keeping what the realm registered. */
  reset(): void;
}

/** How many visits one tape holds before it stops taping. */
const TAPE_LIMIT = 1 << 24;

/** How many notes one tape keeps, and how many characters of each. */
const NOTE_LIMIT = 4096;
const NOTE_LENGTH = 240;

/**
 * A root in front of `engine` that tapes every visit.
 *
 * @param limit How many visits the tape keeps between resets. Past it the tape
 * stops and counts, and the engine goes on recording presence.
 */
function createTap(engine: Engine, limit: number): Tap {
  const inner = engine.root;
  const pass = new Uint8Array(1);
  const empty = new Int32Array(0);

  // One entry per row the engine made, in the order it made them, each with
  // the base it gave the row's regions, so the bases ascend. A module that
  // registers again with another count is a new row with a new base, as it is
  // in the engine; one that registers again unchanged is the row it had.
  const rowIds: ModuleId[] = [];
  const rowCounts: number[] = [];
  const rowBases: number[] = [];
  const known = new Set<number>();

  let tape = new Int32Array(1 << 12);
  let taped = 0;
  let visits = 0;
  // Where the bucket changed, and which bucket it changed to.
  let at: number[] = [];
  let keys: string[] = [];
  let seen = -1;
  let notes: [number, string, string][] = [];
  let unnoted = 0;

  const record = (entry: number): void => {
    const activation = inner.a;
    if (activation !== seen) {
      seen = activation;
      at.push(taped);
      keys.push(engine.current().key);
    }
    visits += 1;
    if (taped >= limit) return;
    if (taped === tape.length) {
      const grown = new Int32Array(Math.min(tape.length * 2, limit));
      grown.set(tape);
      tape = grown;
    }
    tape[taped] = entry;
    taped += 1;
  };

  const root = {
    get a(): number {
      return inner.a;
    },
    get s(): (() => void) | null {
      return inner.s;
    },
    get v(): number {
      return inner.v;
    },
    n: 0,
    l: 0,
    L: empty,
    g(entry: number): void {
      // A row's base with no evaluating bit is no visit: it is the probe
      // logging the module's root on its first hit after a switch, so the
      // bucket it switched to holds the module. The module's root is visited
      // once, while it evaluates, and that entry carries the bit.
      if (!known.has(entry)) record(entry);
      inner.g(entry);
    },
    r(id: ModuleId, count: number) {
      const registered = inner.r(id, count);
      if (!known.has(registered.b)) {
        known.add(registered.b);
        rowIds.push(id);
        rowCounts.push(count);
        rowBases.push(registered.b);
      }
      return { f: registered.f, s: registered.s, b: registered.b, p: pass };
    },
    e(): void {
      inner.e();
    },
    x(): void {
      inner.x();
    },
  };

  const api: Tap = {
    root,
    engine,
    read() {
      return { tape, taped, visits, at, keys, notes, unnoted, rows: { ids: rowIds, counts: rowCounts, bases: rowBases } };
    },
    note(text: string): void {
      if (notes.length >= NOTE_LIMIT) {
        unnoted += 1;
        return;
      }
      const line = text.length > NOTE_LENGTH ? `${text.slice(0, NOTE_LENGTH - 1)}…` : text;
      // Where an async scope decides the bucket, ask it, as a probe would
      // before it writes: a note said in a case's continuation is the case's.
      inner.s?.();
      notes.push([taped, engine.current().key, line]);
    },
    reset(): void {
      notes = [];
      unnoted = 0;
      taped = 0;
      visits = 0;
      at = [];
      keys = [];
      seen = -1;
    },
  };
  Object.defineProperty(root, Symbol.for('variance-authority.test-selection.engine'), { value: engine });
  Object.defineProperty(root, Symbol.for('variance-authority.story.tap'), { value: api });
  return api;
}

/** Where the realm's story listens for notes; `@variance-authority/event` and `eyes` mirror it. */
const NOTE = Symbol.for('variance-authority.story.note');

/** The console methods a case prints with; each line is a note, and still printed. */
const PRINTS = ['log', 'info', 'warn', 'error', 'debug'] as const;

type Channel = (text: string) => void;

/**
 * Have `scope`'s announcements, attention and console lines put on `tap`.
 *
 * The channel is replaced on every call, so a realm that makes a second
 * collector notes onto the tap it uses now. The console is wrapped once: the
 * wrapper looks the channel up when a line is printed, never when it is made.
 */
function listen(tap: Tap, scope: object): void {
  const global = scope as { [NOTE]?: Channel; console?: Console };
  global[NOTE] = (text: string): void => tap.note(String(text));
  const printer = global.console as (Console & { [NOTE]?: true }) | undefined;
  if (printer === undefined || printer[NOTE] === true) return;
  Object.defineProperty(printer, NOTE, { value: true });
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

/** The tap behind a realm's root, when the root is one. */
function tapOf(root: unknown): Tap | undefined {
  if (typeof root !== 'object' || root === null) return undefined;
  return (root as { [key: symbol]: Tap | undefined })[Symbol.for('variance-authority.story.tap')];
}

export = { createTap, tapOf, listen, TAPE_LIMIT, NOTE_LIMIT };
