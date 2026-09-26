/**
 * A journey head that writes parts: what each journey ran in this process,
 * appended to a file the fold joins to its cases after the run.
 *
 * The reporting head in [`journey.ts`](./journey.ts) sends each account to a
 * listener while the run is live. This one sends nothing. A service beyond a
 * fence writes where it is told, the run finishes, and the fold reads every
 * part beside the cases' own frames, joined on the journey id alone.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModuleId } from '../instrument/index.js';
import probeLog from '../instrument/probe-log.cjs';
import journalFormat from './journal-format.cjs';
import type { JourneyCollector, JourneyTrace } from './journey.js';
import { UNATTRIBUTED } from './stitch.js';

/**
 * How a collector a build installed learns the trace afterwards: the build runs
 * before the application's tracing exists, and the application's own
 * `collectJourneys({ trace })` is the first place that can name it.
 */
export const TOLD: unique symbol = Symbol.for('variance-authority.journeys.trace');

type Sink =(frames: readonly Uint8Array[]) => Promise<void> | undefined;

/**
 * The head that writes parts instead of reporting them.
 *
 * One file per process, appended a frame at a time as each journey's scopes
 * release: nothing is acknowledged, and a process killed mid-write leaves a
 * torn last frame the fold reads past. A journey's frame is owned by
 * `\0\0\0\0<journey>`. What the process ran outside any journey, and what a
 * module ran while a request was the first to need it evaluated, is every
 * journey's: it goes in frames owned by the empty journey, which the fold
 * charges to every case whose journey this file names.
 *
 * `target` is a directory, or an `http(s)://` address that
 * [`receiveParts`](./parts-receiver.ts) serves for a runtime with no host
 * filesystem. Over HTTP, a journey's frame is sent before the promise its
 * scope returned settles, so a runtime that ends a request's work with its
 * response still delivers it.
 */
export function writeParts(
  head: string,
  target: string,
  journeyOf: (carried: string | undefined) => string | undefined,
  told?: JourneyTrace,
): JourneyCollector & { readonly [TOLD]: (trace: JourneyTrace) => void } {
  // Asked wherever `enter` did not say, which is every crossing when the
  // application's tracing continues the incoming trace on its own.
  let trace = told;
  // Named on the first send: a Worker installs this at global scope, where
  // workerd refuses random values.
  const append = partSink(target, () => `${head.replace(/[^\w.-]/g, '_')}-${crypto.randomUUID()}.vac`);
  const sent = new Set<Promise<void>>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
  const store = new AsyncLocalStorage<string>();
  const depth = new Map<string, number>();
  const engine = probeLog.createEngine(true);
  type Bucket = ReturnType<typeof engine.open>;
  const buckets = new Map<string, Bucket>();
  const bucketFor = (journey: string): Bucket => {
    let bucket = buckets.get(journey);
    if (bucket === undefined) {
      bucket = engine.open(journey);
      buckets.set(journey, bucket);
      // A promise the handler started and did not return, still running as
      // its request after the scope released: written on the next turn.
      if (journey !== UNATTRIBUTED && !depth.has(journey)) setTimeout(() => void write(journey), 0);
    }
    return bucket;
  };
  let lastJourney = UNATTRIBUTED;
  let lastBucket = bucketFor(UNATTRIBUTED);
  engine.scope((): Bucket => {
    const journey = store.getStore() ?? trace?.current() ?? UNATTRIBUTED;
    if (journey !== lastJourney || lastBucket.closed) {
      lastJourney = journey;
      lastBucket = bucketFor(journey);
    }
    return lastBucket;
  });

  const common = new Map<ModuleId, Set<number>>();
  const keep = (id: ModuleId, ordinal: number): void => {
    let ordinals = common.get(id);
    if (ordinals === undefined) common.set(id, (ordinals = new Set()));
    ordinals.add(ordinal);
  };
  const owner = (journey: string): string =>
    journalFormat.packJourney(journalFormat.packCase('', '', ''), journey);
  const commonFrame = (): Uint8Array | undefined => {
    const bucket = buckets.get(UNATTRIBUTED);
    if (bucket !== undefined) {
      buckets.delete(UNATTRIBUTED);
      for (const module of engine.lists(engine.close(bucket), false)) {
        for (const ordinal of module.hits) keep(module.id, ordinal);
      }
    }
    if (common.size === 0) return undefined;
    const counters = new Map<ModuleId, Uint32Array>();
    for (const [id, ordinals] of common) {
      const entered = new Uint32Array(Math.max(...ordinals) + 1);
      for (const ordinal of ordinals) entered[ordinal] = 1;
      counters.set(id, entered);
    }
    common.clear();
    return journalFormat.encodeJournal(owner(''), counters);
  };
  const journeyFrame = (journey: string): Uint8Array | undefined => {
    const bucket = buckets.get(journey);
    if (bucket === undefined) return undefined;
    buckets.delete(journey);
    const view = engine.close(bucket);
    for (const module of engine.lists(view, false)) {
      for (const ordinal of module.shared) keep(module.id, ordinal);
    }
    return journalFormat.encodeLog(owner(journey), view);
  };
  const send = (frames: (Uint8Array | undefined)[]): Promise<void> | undefined => {
    const written = frames.filter((frame) => frame !== undefined);
    const pending = written.length === 0 ? undefined : append(written);
    if (pending === undefined) return undefined;
    sent.add(pending);
    return pending.finally(() => sent.delete(pending));
  };
  const write = (journey: string): Promise<void> | undefined =>
    depth.has(journey) ? undefined : send([journeyFrame(journey), commonFrame()]);
  const release = (journey: string): Promise<void> | undefined => {
    const open = (depth.get(journey) ?? 1) - 1;
    if (open > 0) {
      depth.set(journey, open);
      return undefined;
    }
    depth.delete(journey);
    return write(journey);
  };
  const flush = async (): Promise<void> => {
    const frames: (Uint8Array | undefined)[] = [];
    for (const journey of buckets.keys()) {
      if (journey !== UNATTRIBUTED) {
        depth.delete(journey);
        frames.push(journeyFrame(journey));
      }
    }
    frames.push(commonFrame());
    send(frames);
    await Promise.all(sent);
  };

  Object.defineProperty(globalThis, '__VA__', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: engine.root,
  });

  return {
    collecting: true,
    head,
    [TOLD]: (by: JourneyTrace) => {
      trace = by;
    },
    enter: <Result,>(carried: string | undefined, body: () => Result): Result => {
      const journey = journeyOf(carried) ?? trace?.current();
      if (journey === undefined) return body();
      depth.set(journey, (depth.get(journey) ?? 0) + 1);
      let done: Result;
      try {
        done = store.run(journey, body);
      } catch (error) {
        void release(journey);
        throw error;
      }
      if (isThenable(done)) {
        return done.then(
          async (value) => {
            await release(journey);
            return value;
          },
          async (error: unknown) => {
            await release(journey);
            throw error;
          },
        ) as Result;
      }
      void release(journey);
      return done;
    },
    flush,
    close: async () => {
      await flush();
      if (previous === undefined) delete (globalThis as Record<string, unknown>)['__VA__'];
      else Object.defineProperty(globalThis, '__VA__', previous);
    },
  };
}

/** Each frame behind its u32 little-endian length, as the fold reads a part. */
export function lengthPrefixed(frames: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const frame of frames) size += 4 + frame.byteLength;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const frame of frames) {
    view.setUint32(at, frame.byteLength, true);
    bytes.set(frame, at + 4);
    at += 4 + frame.byteLength;
  }
  return bytes;
}

function partSink(target: string, name: () => string): Sink {
  if (/^https?:\/\//.test(target)) {
    let url: string | undefined;
    // The previous send finishes first, so the receiver appends in order.
    let last: Promise<void> = Promise.resolve();
    return (frames) => {
      const to = (url ??= `${target.replace(/\/+$/, '')}/${encodeURIComponent(name())}`);
      const body = lengthPrefixed(frames);
      last = last.then(async () => {
        try {
          const response = await fetch(to, { method: 'POST', body });
          await response.arrayBuffer();
        } catch {
          // A receiver that is gone loses this part, never the request.
        }
      });
      return last;
    };
  }
  // A file sink appends in place and holds nothing; `node:fs` is loaded only
  // here, so a runtime without it reaches this module through the HTTP path.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  let file: string | undefined;
  return (frames) => {
    if (file === undefined) {
      file = path.resolve(target, name());
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    fs.appendFileSync(file, lengthPrefixed(frames));
    return undefined;
  };
}

export function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function' &&
    typeof (value as { finally?: unknown }).finally === 'function'
  );
}
