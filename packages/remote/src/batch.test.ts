import { describe, expect, it } from 'vitest';
import { batching, type Settled } from './batch.js';

/**
 * The coalescing itself, with no socket and no renderer.
 *
 * Every claim worth making about batching is a claim about *which calls travel
 * together and what happens when one of them fails*, and both are decided here
 * rather than by the transport. Testing it through HTTP would prove the same
 * things more slowly and would let a wire bug look like a batching bug.
 */

function recorder(): {
  send: (items: readonly number[]) => Promise<readonly Settled<string>[]>;
  batches: number[][];
} {
  const batches: number[][] = [];
  return {
    batches,
    send: async (items) => {
      batches.push([...items]);
      return items.map((item) => ({ ok: true as const, value: `#${item}` }));
    },
  };
}

describe('calls that overlap travel together', () => {
  it('sends everything issued in one turn as one request', async () => {
    const { send, batches } = recorder();
    const call = batching(send);

    const answers = await Promise.all([call(1), call(2), call(3)]);

    expect(batches).toEqual([[1, 2, 3]]);
    expect(answers).toEqual(['#1', '#2', '#3']);
  });

  it('costs a serial caller nothing but its own turn', async () => {
    // The reason the default window is zero. A timer would coalesce more and
    // would tax exactly this caller, who cannot benefit from it, on every item.
    const { send, batches } = recorder();
    const call = batching(send);

    expect(await call(1)).toBe('#1');
    expect(await call(2)).toBe('#2');

    expect(batches).toEqual([[1], [2]]);
  });

  it('flushes as soon as it is full rather than waiting out the window', async () => {
    const { send, batches } = recorder();
    const call = batching(send, { maxBatch: 2, windowMs: 50 });

    await Promise.all([call(1), call(2), call(3), call(4), call(5)]);

    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('answers each caller its own item, by position', async () => {
    const call = batching<number, string>(async (items) =>
      items.map((item) => ({ ok: true as const, value: `v${item}` })),
    );

    expect(await Promise.all([call(9), call(8), call(7)])).toEqual(['v9', 'v8', 'v7']);
  });
});

describe('one item failing is one item failing', () => {
  it('rejects only the caller whose item failed', async () => {
    // A rejected batch would let a malformed subject decide the fate of the
    // fifteen it travelled with, and those fifteen come back as failures the
    // operator has to re-run to find innocent.
    const call = batching<number, string>(async (items) =>
      items.map((item) =>
        item === 2
          ? { ok: false as const, because: 'that one is broken' }
          : { ok: true as const, value: `#${item}` },
      ),
    );

    const [first, second, third] = await Promise.allSettled([call(1), call(2), call(3)]);

    expect(first).toMatchObject({ status: 'fulfilled', value: '#1' });
    expect(second).toMatchObject({ status: 'rejected' });
    expect((second as PromiseRejectedResult).reason.message).toBe('that one is broken');
    expect(third).toMatchObject({ status: 'fulfilled', value: '#3' });
  });

  it('fails every caller when the transport itself failed', async () => {
    // The one case where the batch genuinely is the unit: nothing came back, so
    // nothing can be attributed to anything.
    const call = batching<number, string>(async () => {
      throw new Error('connection refused');
    });

    await expect(Promise.all([call(1), call(2)])).rejects.toThrow('connection refused');
  });

  it('refuses a reply of the wrong length rather than pairing by guess', async () => {
    // Answers are matched by position. Handing item 4 the value meant for item 5
    // produces a comparison nobody can explain and a baseline stored under the
    // wrong name — so a length disagreement fails all of them, loudly.
    const call = batching<number, string>(async () => [{ ok: true as const, value: 'only one' }]);

    await expect(Promise.all([call(1), call(2)])).rejects.toThrow(
      /sent 2 item\(s\) and was answered about 1/,
    );
  });
});
