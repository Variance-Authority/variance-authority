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
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleId } from '../instrument/index.js';
import probeLog from '../instrument/probe-log.cjs';
import journalFormat from './journal-format.cjs';
import type { JourneyCollector } from './journey.js';
import { UNATTRIBUTED } from './stitch.js';

/**
 * The head that writes parts instead of reporting them.
 *
 * One file per process, appended a frame at a time as each journey's scopes
 * release: nothing is acknowledged, nothing waits, and a process killed
 * mid-write leaves a torn last frame the fold reads past. A journey's frame is
 * owned by `\0\0\0<journey>`. What the process ran outside any journey, and
 * what a module ran while a request was the first to need it evaluated, is
 * every journey's: it goes in frames owned by the empty journey, which the fold
 * charges to every case whose journey this file names.
 */
export function writeParts(
  head: string,
  directory: string,
  journeyOf: (carried: string | undefined) => string | undefined,
): JourneyCollector {
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${head.replace(/[^\w.-]/g, '_')}-${process.pid}-${randomUUID()}.vac`);
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
      if (journey !== UNATTRIBUTED && !depth.has(journey)) setImmediate(() => write(journey));
    }
    return bucket;
  };
  let lastJourney = UNATTRIBUTED;
  let lastBucket = bucketFor(UNATTRIBUTED);
  engine.scope((): Bucket => {
    const journey = store.getStore() ?? UNATTRIBUTED;
    if (journey !== lastJourney || lastBucket.closed) {
      lastJourney = journey;
      lastBucket = bucketFor(journey);
    }
    return lastBucket;
  });

  const append = (frame: Uint8Array): void => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(frame.length);
    appendFileSync(file, Buffer.concat([length, frame]));
  };
  const common = new Map<ModuleId, Set<number>>();
  const keep = (id: ModuleId, ordinal: number): void => {
    let ordinals = common.get(id);
    if (ordinals === undefined) common.set(id, (ordinals = new Set()));
    ordinals.add(ordinal);
  };
  const owner = (journey: string): string =>
    journalFormat.packJourney(journalFormat.packCase('', '', ''), journey);
  const writeCommon = (): void => {
    const bucket = buckets.get(UNATTRIBUTED);
    if (bucket !== undefined) {
      buckets.delete(UNATTRIBUTED);
      for (const module of engine.lists(engine.close(bucket), false)) {
        for (const ordinal of module.hits) keep(module.id, ordinal);
      }
    }
    if (common.size === 0) return;
    const counters = new Map<ModuleId, Uint32Array>();
    for (const [id, ordinals] of common) {
      const entered = new Uint32Array(Math.max(...ordinals) + 1);
      for (const ordinal of ordinals) entered[ordinal] = 1;
      counters.set(id, entered);
    }
    common.clear();
    append(journalFormat.encodeJournal(owner(''), counters));
  };
  const write = (journey: string): void => {
    if (depth.has(journey)) return;
    const bucket = buckets.get(journey);
    if (bucket !== undefined) {
      buckets.delete(journey);
      const view = engine.close(bucket);
      for (const module of engine.lists(view, false)) {
        for (const ordinal of module.shared) keep(module.id, ordinal);
      }
      append(journalFormat.encodeLog(owner(journey), view));
    }
    writeCommon();
  };
  const release = (journey: string): void => {
    const open = (depth.get(journey) ?? 1) - 1;
    if (open > 0) {
      depth.set(journey, open);
      return;
    }
    depth.delete(journey);
    write(journey);
  };
  const flush = async (): Promise<void> => {
    for (const journey of buckets.keys()) {
      if (journey !== UNATTRIBUTED) {
        depth.delete(journey);
        write(journey);
      }
    }
    writeCommon();
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
    enter: <Result,>(carried: string | undefined, body: () => Result): Result => {
      const journey = journeyOf(carried);
      if (journey === undefined) return body();
      depth.set(journey, (depth.get(journey) ?? 0) + 1);
      let done: Result;
      try {
        done = store.run(journey, body);
      } catch (error) {
        release(journey);
        throw error;
      }
      if (isThenable(done)) return done.finally(() => release(journey)) as Result;
      release(journey);
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

export function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function' &&
    typeof (value as { finally?: unknown }).finally === 'function'
  );
}
