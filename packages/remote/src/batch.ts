/**
 * Coalescing one call per item into one call per burst, without changing the
 * call.
 *
 * A `Renderer` renders one document, and the run's raster tier goes as wide as
 * the operator allowed — so an offloaded run issues one HTTP request per subject,
 * each with its own connection, its own JSON round trip, and on a farm that
 * scales to zero its own chance of paying for a cold start. The paint itself is
 * ~65 ms; the overhead around it is not small next to that, and it is paid a
 * hundred times for a hundred subjects that could have travelled together.
 *
 * The fix belongs *under* the interface rather than in it. `render(document)`
 * keeps its exact signature — nothing upstream learns a new shape, no caller
 * decides a batch size, and the local and remote renderers stay
 * interchangeable — while calls that overlap in time leave as one request.
 *
 * ## Why the default window is zero
 *
 * A timer would coalesce more, and would tax the case it cannot help: a caller
 * rendering serially waits the whole window for every single item, turning a
 * 65 ms paint into 65 ms plus the window, forever. Zero means *flush what is
 * already waiting* — one turn of the event loop, so a pool that issues eight
 * renders at once sends one request, and a serial caller pays nothing at all.
 *
 * A window is still worth having where a farm bills per invocation rather than
 * per second, which is why it is an option rather than a constant. It is not the
 * default because a default that can make things worse is not a default.
 */

export interface BatchOptions {
  /** Most items in one request. Beyond this the batch flushes and a new one opens. */
  readonly maxBatch?: number;
  /** Milliseconds to keep collecting. `0` flushes on the next turn of the loop. */
  readonly windowMs?: number;
}

/** Sends one batch and answers per item, in the order the items were given. */
export type SendBatch<In, Out> = (items: readonly In[]) => Promise<readonly Settled<Out>[]>;

/**
 * One item's outcome, never the batch's.
 *
 * A batch that failed as a whole because one document in it was malformed would
 * make a request's contents decide the fate of unrelated subjects — the same
 * reason `run` records a failure against the subject that caused it and keeps
 * going. So the transport reports per item, and a caller sees exactly the error
 * it would have seen had it been alone.
 */
export type Settled<Out> = { readonly ok: true; readonly value: Out } | { readonly ok: false; readonly because: string };

const DEFAULT_MAX_BATCH = 16;

interface Waiting<In, Out> {
  readonly item: In;
  resolve(value: Out): void;
  reject(error: Error): void;
}

/**
 * Wrap a per-item call so overlapping calls travel together.
 *
 * The returned function is the one callers keep. Its contract is unchanged: one
 * item in, one value or one rejection out.
 */
export function batching<In, Out>(
  send: SendBatch<In, Out>,
  options: BatchOptions = {},
): (item: In) => Promise<Out> {
  const maxBatch = Math.max(1, options.maxBatch ?? DEFAULT_MAX_BATCH);
  const windowMs = Math.max(0, options.windowMs ?? 0);

  let waiting: Waiting<In, Out>[] = [];
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    if (waiting.length === 0) return;

    const batch = waiting;
    waiting = [];
    void deliver(batch);
  }

  async function deliver(batch: readonly Waiting<In, Out>[]): Promise<void> {
    let settled: readonly Settled<Out>[];
    try {
      settled = await send(batch.map((entry) => entry.item));
    } catch (error) {
      // A transport failure is everybody's, and it is the one case where the
      // batch genuinely is the unit: nothing came back, so nothing can be
      // attributed. Each caller sees it as its own rejection.
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const entry of batch) entry.reject(failure);
      return;
    }

    if (settled.length !== batch.length) {
      // Answers matched to requests by position, so a length disagreement means
      // every pairing after the first is a guess. Refused rather than zipped:
      // handing subject 4 the raster meant for subject 5 produces a comparison
      // nobody can explain and a baseline stored under the wrong name.
      const failure = new Error(
        `batched call sent ${batch.length} item(s) and was answered about ${settled.length}; ` +
          'answers are matched by position and cannot be paired',
      );
      for (const entry of batch) entry.reject(failure);
      return;
    }

    batch.forEach((entry, index) => {
      const answer = settled[index]!;
      if (answer.ok) entry.resolve(answer.value);
      else entry.reject(new Error(answer.because));
    });
  }

  return (item: In): Promise<Out> =>
    new Promise<Out>((resolve, reject) => {
      waiting.push({ item, resolve, reject });

      // Full is flushed now rather than on the timer: the point of a maximum is
      // that the batch stops growing, and waiting after it is full is latency
      // bought for nothing.
      if (waiting.length >= maxBatch) {
        flush();
        return;
      }

      if (scheduled) return;
      scheduled = true;
      // `unref` where it exists, so a pending window never holds a process open
      // past the work — a CLI that exits on the last render must not wait 10 ms
      // for a batch that has already been sent.
      const timer = setTimeout(flush, windowMs);
      (timer as { unref?: () => void }).unref?.();
    });
}
