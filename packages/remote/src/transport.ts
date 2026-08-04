/**
 * One `fetch` with a deadline, for both halves of this package.
 *
 * ## Why this is not four lines of `AbortController`
 *
 * It was, and it failed on Node 24 in exactly one situation — a jsdom test
 * environment — with `RequestInit: Expected signal ("AbortSignal {}") to be an
 * instance of AbortSignal`. Two realms meeting at `fetch`: a test environment
 * installs its own DOM globals over the process's, so `new AbortController()`
 * produces jsdom's signal while `fetch` is still the runtime's and brand-checks
 * against its own.
 *
 * That situation is not a corner. **jsdom is the environment this package
 * exists for.** The claim the retention design rests on is that a document
 * acquired in a unit test can be painted by a pinned machine two networks away,
 * and a unit test that collects from jsdom is precisely where the two globals
 * disagree. A remote renderer that works everywhere except the caller it was
 * designed for is not working.
 *
 * A library cannot fix the disagreement — it shares one `globalThis` with
 * whatever replaced the globals, and there is no realm-tagged constructor to
 * reach for. So it detects it instead, once, and remembers.
 *
 * ## What each path costs
 *
 * With a signal the request is *cancelled*: the socket closes and the far end
 * stops working. Without one the promise rejects on time and the request is
 * abandoned rather than stopped — the caller is unblocked, which is the contract
 * ({@link fetchWithin} never resolves late), and the connection lingers until the
 * server gives up. That is a real cost and it is paid only in the environment
 * that forced it.
 */

/**
 * Whether this process's `fetch` accepts this process's `AbortSignal`.
 *
 * Assumed true and demoted by evidence, never probed: probing means a request,
 * and a request to find out how to make requests is a worse trade than one
 * retried call per process. Module state rather than a parameter because the
 * answer is a property of the runtime, identical for every endpoint.
 */
let signalAccepted = true;

/** The realm mismatch, recognized by what the runtime actually says about it. */
function isForeignSignal(error: unknown): boolean {
  return error instanceof TypeError && /AbortSignal/i.test(error.message);
}

export class TimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`${url} did not answer within ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

async function raced(
  get: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      get(url, init),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(url, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Fetch, or reject by `timeoutMs`. Never resolves after the deadline.
 *
 * The distinction the callers depend on: a store that cannot answer must never
 * be heard as answering, and a renderer that hangs must never be a stalled run.
 * Both are satisfied by rejecting on time, whichever path got us there.
 */
export async function fetchWithin(
  get: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (signalAccepted) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await get(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (!isForeignSignal(error)) throw error;

      // Demoted for the life of the process. Retrying the same doomed call on
      // every request would turn one runtime quirk into a permanent double
      // round-trip on a path whose whole purpose is to be cheap.
      signalAccepted = false;
    } finally {
      clearTimeout(timer);
    }
  }

  return await raced(get, url, init, timeoutMs);
}
