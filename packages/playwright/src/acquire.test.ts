import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { acquireFromAgent } from './acquire.js';
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
