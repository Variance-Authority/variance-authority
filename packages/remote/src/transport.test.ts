import { describe, expect, it } from 'vitest';
import { fetchWithin } from './transport.js';

/**
 * The deadline, and the runtime quirk that made it two code paths.
 *
 * **These run in order and share module state on purpose.** `fetchWithin`
 * remembers whether this process's `fetch` accepted this process's
 * `AbortSignal`, because the answer is a property of the runtime rather than of
 * a call — so the demotion below is permanent for the rest of this file, and the
 * last test is what checks that it stuck. Reordering them is not a
 * rearrangement, it is a different test.
 */

/** A `fetch` that honours the signal, as a real one does. */
function hangs(seen: RequestInit[] = []): typeof globalThis.fetch {
  return ((_url: string, init: RequestInit) => {
    seen.push(init);
    return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as unknown as typeof globalThis.fetch;
}

/** A `fetch` that brand-checks the signal and finds it foreign, as Node 24 does. */
function refusesForeignSignals(seen: RequestInit[]): typeof globalThis.fetch {
  return ((_url: string, init: RequestInit) => {
    seen.push(init);
    if (init.signal !== undefined && init.signal !== null) {
      return Promise.reject(
        new TypeError('RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal'),
      );
    }
    return new Promise<Response>(() => {});
  }) as unknown as typeof globalThis.fetch;
}

describe('fetchWithin', () => {
  it('passes a response through untouched', async () => {
    const ok = new Response('{}', { status: 200 });
    const get = (() => Promise.resolve(ok)) as unknown as typeof globalThis.fetch;

    expect(await fetchWithin(get, 'http://x/y', {}, 50)).toBe(ok);
  });

  it('rejects by the deadline rather than stalling the run', async () => {
    await expect(fetchWithin(hangs(), 'http://x/y', {}, 20)).rejects.toThrow();
  });

  it('still rejects by the deadline when the runtime refuses the signal', async () => {
    // The Node 24 finding, reproduced: a jsdom environment installs its own DOM
    // globals, so the signal and the `fetch` come from two realms and the brand
    // check fails. Before the fallback this surfaced as a `TypeError` about
    // `AbortSignal` — a failure that reads like a bug in the caller's code and is
    // nothing of the sort.
    const seen: RequestInit[] = [];

    await expect(
      fetchWithin(refusesForeignSignals(seen), 'http://x/y', { method: 'POST' }, 20),
    ).rejects.toThrow(/did not answer within 20ms/);

    // Two attempts: the signalled one that was refused, then the raced one.
    expect(seen).toHaveLength(2);
    expect(seen[0]?.signal).toBeDefined();
    expect(seen[1]?.signal).toBeUndefined();
  });

  it('remembers the refusal, so every later call skips the doomed attempt', async () => {
    // The point of the memory. Retrying a call the runtime has already refused,
    // on every request, would turn one quirk into a permanent double round-trip
    // on the phase this project offloads in order to make it cheaper.
    const seen: RequestInit[] = [];

    await expect(
      fetchWithin(refusesForeignSignals(seen), 'http://x/y', { method: 'POST' }, 20),
    ).rejects.toThrow(/did not answer within 20ms/);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBeUndefined();
  });
});
