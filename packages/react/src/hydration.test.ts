import { describe, expect, it } from 'vitest';
import { awaitHydration } from './hydration.js';

/**
 * A document React has not reached yet, and a script that commits into it.
 *
 * The barrier reads one thing — how many nodes carry a fiber — so the fake is
 * exactly that: a scope whose `querySelectorAll` answers with elements, some of
 * which have had the expando written onto them. `__reactFiber$` is the key
 * React uses, and `hasFiber` finds it by prefix.
 */
function commitable(total: number): {
  readonly scope: Node;
  commit(count: number): void;
} {
  const elements = Array.from({ length: total }, () => ({}) as Record<string, unknown>);

  const scope = {
    querySelectorAll: () => elements,
  } as unknown as Node;

  return {
    scope,
    commit(count) {
      for (let index = 0; index < count; index += 1) {
        const element = elements[index];
        if (element !== undefined) element['__reactFiber$abc'] = { tag: 5 };
      }
    },
  };
}

describe('waiting for React to commit into a server-rendered document', () => {
  /**
   * The property the whole module turns on. A static page holds still at zero
   * fibers for as long as anybody watches it, and a barrier that released on a
   * *steady* count without asking whether the count was anything would report
   * every page with no React on it as hydrated the moment it was read twice —
   * and would release a React page the instant before its first commit.
   */
  it('never confirms a document that carries no fiber at all', async () => {
    const page = commitable(20);

    const settled = await awaitHydration(page.scope, { timeoutMs: 60, pollMs: 4 });

    expect(settled.hydrated).toBe(false);
    expect(settled.fibers).toBe(0);
  });

  /**
   * The bug the confirmations exist for, and the one that made this a fix rather
   * than a wait. Releasing on *any* fiber let the capture land in the middle of
   * a commit: two pages of a real site came back carrying provenance on 63 and
   * 94 nodes where a settled read of the same pages carried 870 and 1693. The
   * report was not empty, which is what made it convincing.
   */
  it('does not release in the middle of a commit', async () => {
    const page = commitable(40);

    let landed = 0;
    const progressive = setInterval(() => {
      landed += 5;
      page.commit(landed);
      if (landed >= 40) clearInterval(progressive);
    }, 3);

    const settled = await awaitHydration(page.scope, { timeoutMs: 2_000, pollMs: 16 });
    clearInterval(progressive);

    expect(settled.hydrated).toBe(true);
    expect(settled.fibers).toBe(40);
  });

  /**
   * The limit, stated rather than left to be discovered. This is quiescence, not
   * a signal from React: a commit that pauses for longer than the confirmation
   * window is indistinguishable from one that finished. Widening the window
   * costs every subject the wait, so the trade is `confirmations`, and a caller
   * that knows its page streams in bursts is the one who should widen it.
   */
  it('reads a long enough pause as the end of the commit', async () => {
    const page = commitable(40);
    page.commit(10);

    const settled = await awaitHydration(page.scope, {
      timeoutMs: 2_000,
      pollMs: 2,
      confirmations: 2,
    });

    expect(settled).toMatchObject({ hydrated: true, fibers: 10 });
  });

  it('returns as soon as a committed document confirms', async () => {
    const page = commitable(5);
    page.commit(5);

    const settled = await awaitHydration(page.scope, { timeoutMs: 2_000, pollMs: 4 });

    expect(settled).toMatchObject({ hydrated: true, fibers: 5 });
  });

  /**
   * A timeout is an answer, not a failure. A page still committing when the
   * budget runs out is hydrated and says how far it got; a page that never
   * committed is not. Neither throws, because a run that took a slow page down
   * reports nothing about the other twenty-nine.
   */
  it('answers with what it saw when the budget runs out', async () => {
    // A document that never stops growing, so the count never repeats and the
    // barrier can only end on its budget.
    let served = 1;
    const endless = {
      querySelectorAll: () =>
        Array.from({ length: (served += 1) }, () => ({ ['__reactFiber$abc']: { tag: 5 } })),
    } as unknown as Node;

    const settled = await awaitHydration(endless, { timeoutMs: 40, pollMs: 4 });

    expect(settled.hydrated).toBe(true);
    expect(settled.waitedMs).toBeGreaterThanOrEqual(40);
  });

  /** A scope that cannot be queried is still asked about itself. */
  it('reads a node that has no children to query', async () => {
    const lone = {} as Record<string, unknown>;

    expect((await awaitHydration(lone as unknown as Node, { timeoutMs: 20, pollMs: 4 })).hydrated).toBe(
      false,
    );

    lone['__reactFiber$abc'] = { tag: 3 };
    expect((await awaitHydration(lone as unknown as Node, { timeoutMs: 200, pollMs: 4 })).fibers).toBe(1);
  });
});
