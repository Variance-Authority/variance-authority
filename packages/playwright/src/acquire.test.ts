import { stepClock } from '@variance-authority/core/format';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { UnansweredAssets, acquireFromAgent } from './acquire.js';
import { watchArrivals } from './arrivals.js';
import type { NetworkObservation } from './network.js';

/**
 * The ordering, pinned with no browser in it.
 *
 * What is under test is not what the agent computes — it is *which asset map the
 * agent was handed*, and that is a question about two things happening in the
 * driver in the right order. A fake page records the requests it was asked to
 * evaluate; a fake observation grows its map when it is settled, which is what a
 * page with deferred images does to a real one.
 */

/** A page that records every request the agent was handed. */
function pageRecording(sent: object[]): Page {
  return {
    evaluate: async (_fn: unknown, arg: readonly [string, object]) => {
      sent.push(arg[1]);
      return `acquired ${sent.length}`;
    },
  } as unknown as Page;
}

/** An observation whose map becomes `after` the moment it is settled. */
function wireThatFetchesDuringStabilization(
  before: Record<string, string>,
  after: Record<string, string>,
): NetworkObservation {
  let assets = before;
  return {
    get assets() {
      return assets;
    },
    settle: async () => {
      assets = after;
    },
  } as unknown as NetworkObservation;
}

describe('acquiring over an asset map that is still filling', () => {
  it('hands the agent what the wire had seen', async () => {
    const sent: object[] = [];
    const wire = wireThatFetchesDuringStabilization({ 'a.png': 'v1:a' }, { 'a.png': 'v1:a' });

    await acquireFromAgent(pageRecording(sent), wire, { subjectId: 'route/x' });

    expect(sent).toEqual([{ subjectId: 'route/x', assets: { 'a.png': 'v1:a' } }]);
  });

  it('reads the page again when stabilization asked for more', async () => {
    const sent: object[] = [];
    const wire = wireThatFetchesDuringStabilization(
      { 'above.png': 'v1:a' },
      { 'above.png': 'v1:a', 'below.png': 'v1:b' },
    );

    const raw = await acquireFromAgent(pageRecording(sent), wire, { subjectId: 'route/x' });

    // The reading that is kept is the one keyed on every asset the page has,
    // not the one taken before the deferred images were asked for.
    expect(raw).toBe('acquired 2');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      subjectId: 'route/x',
      assets: { 'above.png': 'v1:a', 'below.png': 'v1:b' },
    });
  });

  it('notices an asset served different bytes under the same URL', async () => {
    const sent: object[] = [];
    const wire = wireThatFetchesDuringStabilization({ 'logo.svg': 'v1:a' }, { 'logo.svg': 'v1:b' });

    await acquireFromAgent(pageRecording(sent), wire, { subjectId: 'route/x' });

    expect(sent).toHaveLength(2);
  });

  it('refuses with its own error when an asset the read asked for never arrives', async () => {
    // Its own type, so a collector can refuse that subject and go on to the next.
    const wire = {
      assets: {},
      settle: async () => '1 image, font or media request had no answer: below.png',
    } as unknown as NetworkObservation;

    const reading = acquireFromAgent(pageRecording([]), wire, { subjectId: 'route/x' });

    await expect(reading).rejects.toBeInstanceOf(UnansweredAssets);
    await expect(reading).rejects.toThrow(/below\.png/);
  });

  it('reads once when the wire never moved', async () => {
    const sent: object[] = [];
    const same = { 'a.png': 'v1:a', 'b.png': 'v1:b' };
    const wire = wireThatFetchesDuringStabilization(same, { ...same });

    const raw = await acquireFromAgent(pageRecording(sent), wire, { subjectId: 'route/x' });

    expect(raw).toBe('acquired 1');
    expect(sent).toHaveLength(1);
  });

  it('sends no assets key at all when nothing was observing the wire', async () => {
    const sent: object[] = [];

    await acquireFromAgent(pageRecording(sent), undefined, { subjectId: 'route/x' });

    // Not an empty map: `assets: {}` and no `assets` are the same environment
    // key, and a run with observation off should not claim to have looked.
    expect(sent).toEqual([{ subjectId: 'route/x' }]);
  });
});

describe('the steps of acquiring', () => {
  const names = async (wire: NetworkObservation | undefined): Promise<string[]> => {
    const steps = stepClock(() => performance.now());
    await acquireFromAgent(pageRecording([]), wire, { subjectId: 'route/x' }, steps);
    return steps.taken.map((step) => step.step);
  };

  it('takes the one read, and no wait, when nothing observes the wire', async () => {
    expect(await names(undefined)).toEqual(['read']);
  });

  it('takes the read and the wait for the wire when the wire held still', async () => {
    const same = { 'a.png': 'v1:a' };
    expect(await names(wireThatFetchesDuringStabilization(same, { ...same }))).toEqual(['read', 'network']);
  });

  it('names the reading the wire outdated `stale`, and the one kept `read`', async () => {
    const wire = wireThatFetchesDuringStabilization({ 'a.png': 'v1:a' }, { 'a.png': 'v1:b' });
    expect(await names(wire)).toEqual(['stale', 'network', 'read']);
  });
});

/**
 * A page that emits the requests a test sends it, and whose agent fails. With
 * `asking`, the agent was waiting for the next arrival of that kind when it
 * failed.
 */
function pageStuckOn(asking?: 'any' | 'script'): { readonly page: Page; request(url: string, type: string): void } {
  const handlers = new Map<string, Array<(request: unknown) => void>>();
  let arrival: ((of: string) => Promise<boolean>) | undefined;
  const page = {
    on: (event: string, handler: (request: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    exposeFunction: async (_name: string, fn: (of: string) => Promise<boolean>) => {
      arrival = fn;
    },
    evaluate: async () => {
      if (asking !== undefined) void arrival?.(asking);
      await Promise.resolve();
      throw new Error('Target page, context or browser has been closed');
    },
  } as unknown as Page;
  const request = (url: string, type: string): void => {
    for (const handler of handlers.get('request') ?? []) handler({ url: () => url, resourceType: () => type });
  };
  return { page, request };
}

describe('an agent that never answered', () => {
  /**
   * A request that never ends — a long poll — holds a wait that follows the
   * wire for as long as it is open, and whatever ends the run ends it with
   * Playwright's word for a closed page. The run's last word is the request.
   */
  it('names the requests that were still arriving', async () => {
    const stuck = pageStuckOn('any');
    await watchArrivals(stuck.page);
    stuck.request('https://app.test/poll?since=1', 'fetch');
    stuck.request('https://app.test/intro.mp4', 'media');
    stuck.request('https://app.test/stalled.woff2', 'font');
    stuck.request('https://app.test/hero.png', 'image');

    const failed = acquireFromAgent(stuck.page, undefined, { subjectId: 'route/x' });

    await expect(failed).rejects.toThrow(/1 request .*still arriving: https:\/\/app\.test\/poll\?since=1$/);
    await expect(failed).rejects.toHaveProperty('cause.message', 'Target page, context or browser has been closed');
  });

  it('names only the scripts when the agent was waiting for a script', async () => {
    const stuck = pageStuckOn('script');
    await watchArrivals(stuck.page);
    stuck.request('https://app.test/poll?since=1', 'fetch');
    stuck.request('https://app.test/client.js', 'script');

    await expect(acquireFromAgent(stuck.page, undefined, { subjectId: 'route/x' })).rejects.toThrow(
      /1 request .*still arriving: https:\/\/app\.test\/client\.js$/,
    );
  });

  /** An open long poll is not why an agent that never asked the wire failed. */
  it('passes on the failure of an agent that was not waiting on the wire', async () => {
    const stuck = pageStuckOn();
    await watchArrivals(stuck.page);
    stuck.request('https://app.test/poll?since=1', 'fetch');

    await expect(acquireFromAgent(stuck.page, undefined, { subjectId: 'route/x' })).rejects.toThrow(
      /^Target page, context or browser has been closed$/,
    );
  });

  it('passes on the failure of a page with nothing arriving', async () => {
    const stuck = pageStuckOn('any');
    await watchArrivals(stuck.page);

    await expect(acquireFromAgent(stuck.page, undefined, { subjectId: 'route/x' })).rejects.toThrow(
      'Target page, context or browser has been closed',
    );
  });
});
