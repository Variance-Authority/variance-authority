// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { collectStories } from './preview.js';
import { BASE, TIMING, fakePage, fakePreview, type FakePreview } from './preview-fake.js';

/**
 * A Storybook older than the spelling this adapter was written against.
 *
 * Its own suite because the failure it guards is not a wrong answer but no
 * answer: detaching listeners happens inside the call that hands the result
 * back, so a channel missing the method used to detach strands the promise and
 * the session stops on its first story with the page idle and nothing left to
 * settle it. That is indistinguishable from a slow story until something looks,
 * which is exactly why it is worth a test rather than a defensive line.
 *
 * Storybook 5 is the concrete case: `Channel` exposes `removeListener` and no
 * `off`, and hangs itself on `window.__STORYBOOK_ADDONS_CHANNEL__`. Nothing
 * else about that preview is unusual — the events, the payloads, and the story
 * root are the ones this adapter already reads.
 */

let preview: FakePreview | null = null;

afterEach(() => {
  preview?.dispose();
  preview = null;
});

describe('a preview whose channel predates `off`', () => {
  it('reads every story and detaches through `removeListener`', async () => {
    preview = fakePreview({ 'a--one': 'renders', 'a--two': 'renders' }, true, 'legacy');
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'rendered']);
    expect(outcomes.map((outcome) => outcome.readiness)).toEqual(['storyRendered', 'storyRendered']);
    // One, and only one: the end-of-render watch, installed once per document
    // and re-aimed per story. Every listener `showStory` attached is gone,
    // which is the point of detaching at all — a handler left attached answers
    // for the next story as well.
    expect(preview.listeners()).toBe(1);
    // The channel was found, so switching went over it rather than through a
    // reload — which is the difference between a session and a page per story.
    expect(outcomes.every((outcome) => outcome.channel)).toBe(true);
  });

  it('finishes and says so when the channel cannot be detached from at all', async () => {
    // Neither spelling. Leaking listeners is the lesser harm and the only
    // harm that is allowed to be chosen silently — so it is reported.
    preview = fakePreview({ 'a--one': 'renders' }, true, 'undetachable');
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[0]?.status).toBe('rendered');
    expect(outcomes[0]?.warnings.join('\n')).toContain('removeListener');
  });
});
