/**
 * The two test-runner collectors, shared by the Jest and Vitest halves.
 *
 * A collector decides which bucket the probe log is writing into and reads the
 * buckets out when the file is done: `flat` keeps one for the file, `scoped`
 * one per case plus the ambient bucket no case owns. What a bucket is, and why
 * switching between them costs only what the last one touched, is in
 * `instrument/probe-log.cts`.
 *
 * Jest requires this from its setup file inside the sandbox, and the Vitest
 * setup module loads it with `createRequire`; both run the same code, so a
 * difference between the two runners' journals is a difference in the runner.
 * CommonJS for the reason `journal-format.cts` is.
 */

import async_hooks = require('node:async_hooks');
import journals = require('./journal-format.cjs');
import probeLog = require('../instrument/probe-log.cjs');
import type { ModuleId } from '../instrument/index.js';

type Engine = ReturnType<typeof probeLog.createEngine>;
type Bucket = ReturnType<Engine['open']>;
type View = ReturnType<Engine['read']>;
type Presence = Map<ModuleId, Uint32Array>;

/** What the journal writer reads once the file is done with. */
interface Collector {
  /** Whether a bucket is kept per case. */
  readonly scoped: boolean;
  /**
   * What had run before the file's first test.
   *
   * Called once, from the first `beforeAll`. The scoped collector writes it as
   * the ambient frame there and starts a new ambient bucket.
   */
  seal(testFile: string): ReadonlyMap<ModuleId, Uint32Array>;
  /**
   * Everything the file entered, whichever case entered it, and a frame per
   * bucket where cases are recorded. Closes every bucket still open.
   */
  finish(testFile: string): {
    readonly modules: ReadonlyMap<ModuleId, Uint32Array>;
    readonly frames: readonly Uint8Array[] | undefined;
  };
  /**
   * The cases that made a crossing after they had settled.
   *
   * Empty in the mode that cannot see one: a variable has no memory of a case
   * that closed, so a late crossing lands in the ambient bucket unnamed.
   */
  runaways(): readonly string[];
}

interface Holder {
  __VA__?: unknown;
}

/** What a case frame calls the bucket no case owns; mirrors `AMBIENT` in `cases.ts`. */
const AMBIENT = '';

/** Where the runner half of the seam finds the scope; mirrors `CASE_SCOPE` in `cases.ts`. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

/** Mirrors `EVALUATING` in `../instrument/index.ts`, with the entered bit beside it. */
const ENTERED_EVALUATING = 0x80000001;

/**
 * A read-out as one array per module, 1 for entered and the evaluating bit
 * beside it: what `encodeJournal` reads, and all it reads.
 */
function presenceOf(view: View): Presence {
  const out: Presence = new Map();
  for (const row of view.rows) {
    const counters = new Uint32Array(view.counts[row]!);
    for (let at = view.start[row]!; at < view.end[row]!; at += 1) {
      const value = view.sorted[at]!;
      counters[value >>> 1] = value & 1 ? ENTERED_EVALUATING : 1;
    }
    out.set(view.ids[row]!, counters);
  }
  return out;
}

/**
 * Or a bucket into the file's union. A module whose block count changed
 * restarts from this bucket: its old ordinals name regions the new text does
 * not have.
 */
function foldInto(union: Presence, view: View): void {
  for (const row of view.rows) {
    const id = view.ids[row]!;
    const count = view.counts[row]!;
    let counters = union.get(id);
    if (counters === undefined || counters.length !== count) {
      counters = new Uint32Array(count);
      union.set(id, counters);
    }
    for (let at = view.start[row]!; at < view.end[row]!; at += 1) {
      const value = view.sorted[at]!;
      counters[value >>> 1]! |= value & 1 ? ENTERED_EVALUATING : 1;
    }
  }
}

/**
 * The realm's engine, made and installed if this is the first collector in it.
 *
 * Exported for a host that loads instrumented modules before its first
 * collector exists: `runner.ts` installs the engine when it registers its
 * module hooks, and every probe that fires before a file is observed writes
 * into the idle bucket rather than into a missing root.
 *
 * Vitest without isolation evaluates this once per test file in one realm, and
 * every module the first file evaluated has already read the root and keeps it.
 * So a later file writes into the same engine through buckets of its own. The
 * two kinds of engine differ in whether the root asks an async scope on every
 * probe, which a realm decides once.
 */
function attach(holder: Holder, continuations: boolean): Engine {
  const found = probeLog.engineOf(holder.__VA__);
  if (found !== undefined) {
    if (found.scoped === continuations) return found;
    throw new Error(
      'variance-authority: this realm is already recording ' +
        (found.scoped ? 'with' : 'without') +
        ' continuations, and a module keeps the recording it first found.',
    );
  }
  const engine = probeLog.createEngine(continuations);
  holder.__VA__ = engine.root;
  return engine;
}

/**
 * The coordinate is `file\0declaration path\0ordinal`; a reader knows a case by
 * the middle one, and the ambient bucket by the only one it has.
 */
const nameOf = (key: string): string => key.split('\u0000')[1] || key.split('\u0000')[0] || AMBIENT;

const twoAtOnce = (open: string, opening: string): string =>
  `variance-authority: ${nameOf(open)} was still running when ${nameOf(opening)} started, ` +
  `in ${open.split('\u0000')[0]}. Per-case recording holds one case at a time, so this file ` +
  'is recorded as a whole: a change it reaches runs every case in it. Two cases open at once ' +
  'is a concurrent group, or a case that left work behind. Record with ' +
  '{ continuations: true } to follow every case through the async context and name the ' +
  'ones whose work outlived them.';

/** One bucket for the file. */
function flat(holder: Holder): Collector {
  const engine = attach(holder, false);
  const bucket = engine.open(AMBIENT);
  engine.use(bucket);
  return {
    scoped: false,
    seal: () => presenceOf(engine.read(bucket)),
    finish: () => ({ modules: presenceOf(engine.close(bucket)), frames: undefined }),
    runaways: () => [],
  };
}

/**
 * One bucket per case.
 *
 * @param continuations Hold the case bracket in an async context rather than
 * a variable, and mark the cases whose work outlived them.
 */
function scoped(holder: Holder, continuations: boolean): Collector {
  const engine = attach(holder, continuations);
  const buckets = new Map<string, Bucket>();
  const late = new Set<string>();
  // A bucket is written the moment its case settles and then dropped, so a
  // worker holds one case's log and the file's union, never every case until
  // `afterAll`.
  const union: Presence = new Map();
  const frames: Uint8Array[] = [];
  const close = (bucket: Bucket, name: string): View | undefined => {
    if (buckets.get(bucket.key) === bucket) buckets.delete(bucket.key);
    const view = engine.close(bucket);
    if (view.rows.length === 0) return undefined;
    frames.push(journals.encodeLog(name, view));
    foldInto(union, view);
    return view;
  };
  const bucketFor = (key: string): Bucket => {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = engine.open(key);
      buckets.set(key, bucket);
    }
    return bucket;
  };

  let ambient = bucketFor(AMBIENT);
  // Set when a second case opens while one is still open and no async context
  // tells them apart. From then on every crossing is the file's, and the file
  // writes no case frame: a case credited with less than it reached is a case
  // a change can skip, and the file-level record is still exact.
  let tangled = false;
  // One case at a time, so the case running now is a variable that `enter`
  // and `release` move, and the probe never asks.
  let current = ambient;
  const scopes = continuations ? new async_hooks.AsyncLocalStorage<Bucket>() : undefined;
  if (scopes === undefined) engine.use(ambient);
  else {
    // The store holds the bucket itself, so asking costs one `getStore()`.
    engine.scope((): Bucket => {
      const bucket = scopes.getStore();
      if (bucket === undefined) return ambient;
      if (bucket.open) return bucket;
      // A crossing under a case that has already settled is that case still
      // working, which is the whole reason this mode exists.
      late.add(bucket.key);
      if (!bucket.closed) return bucket;
      // Its bucket is written already, so the late work opens a second under
      // the same key, and the reader joins the two frames into one case.
      const again = bucketFor(bucket.key);
      again.open = false;
      return again;
    });
  }

  const release = (bucket: Bucket): void => {
    bucket.open = false;
    if (current === bucket) {
      current = ambient;
      engine.use(ambient);
    }
    if (!bucket.closed) close(bucket, bucket.key);
  };
  // A case is over when its body settles, not when it returns: an async case
  // returns a promise at its first await and everything past that await is
  // still the case. A synchronous one has no promise and is over on return.
  const settling = <Result,>(bucket: Bucket, body: () => Result): Result => {
    let answered: Result;
    try {
      answered = body();
    } catch (thrown) {
      release(bucket);
      throw thrown;
    }
    const thenable = answered as { then?: unknown } | null | undefined;
    if (thenable == null || typeof thenable.then !== 'function') {
      release(bucket);
      return answered;
    }
    return (answered as unknown as Promise<unknown>).then(
      (value) => { release(bucket); return value; },
      (thrown: unknown) => { release(bucket); throw thrown; },
    ) as unknown as Result;
  };
  const enter = <Result,>(key: string, body: () => Result): Result => {
    if (tangled) return body();
    if (scopes === undefined && current !== ambient) {
      tangled = true;
      console.warn(twoAtOnce(current.key, key));
      current = ambient;
      engine.use(ambient);
      return body();
    }
    const bucket = bucketFor(key);
    bucket.open = true;
    if (scopes !== undefined) return scopes.run(bucket, () => settling(bucket, body));
    current = bucket;
    engine.use(bucket);
    return settling(bucket, body);
  };
  (holder as { [CASE_SCOPE]?: unknown })[CASE_SCOPE] = { enter };

  const ambientKey = (testFile: string): string => journals.packCase(testFile, '', '');
  return {
    scoped: true,
    seal(testFile) {
      const before = ambient;
      buckets.delete(AMBIENT);
      ambient = bucketFor(AMBIENT);
      ambient.d = before.d;
      if (current === before) {
        current = ambient;
        if (scopes === undefined) engine.use(ambient);
      }
      const view = close(before, ambientKey(testFile));
      return view === undefined ? new Map() : presenceOf(view);
    },
    finish(testFile) {
      for (const [key, bucket] of buckets) close(bucket, key === AMBIENT ? ambientKey(testFile) : key);
      return { modules: union, frames: tangled ? undefined : frames };
    },
    runaways: () => [...late].map(nameOf),
  };
}

export = { attach, flat, scoped, presenceOf, foldInto };
