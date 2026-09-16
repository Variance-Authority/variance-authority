// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_GLOBALS, collectStories, collectStory } from './preview.js';
import { BASE, TIMING, fakePage, fakePreview, type FakePreview } from './preview-fake.js';

/**
 * Standing an addon down for one pass, without touching the project.
 *
 * `@storybook/addon-a11y` with `test` set runs an axe scan in `afterEach`, on
 * every story. A visual pass pays for that twice — once for the scan, once for
 * the phase a session has to wait out before it can switch stories — and reads
 * the answer never. So the session says `a11y.manual` on the preview's own
 * channel, which is the switch the manager's Accessibility panel flips.
 *
 * The claim these tests exist to hold down is the *negative* one. This adapter
 * cannot replace axe and does not try to: what it suppresses is the scan inside
 * its own session, in a document it opened and will close. A project's own
 * accessibility run is a different run, and anything that quietly edited the
 * project's a11y configuration to make a visual pass faster would be trading
 * away a thing the adopter cares about for a thing they do not see.
 */

let preview: FakePreview | null = null;

afterEach(() => {
  preview?.dispose();
  preview = null;
});

/** What the page function said on the channel, in order, ignoring story switches. */
function announced(from: FakePreview): readonly unknown[] {
  return from.emitted.filter((entry) => entry.event === 'updateGlobals').map((entry) => entry.payload);
}

describe('what a pass tells the preview it is for', () => {
  it('turns off the a11y addon’s automatic scan, in the addon’s own vocabulary', async () => {
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    // `a11y.manual` and nothing else. A session that disabled more would be
    // deciding for the project what its preview is allowed to do.
    expect(announced(preview)).toEqual([{ globals: { a11y: { manual: true } } }]);
    expect(DEFAULT_PREVIEW_GLOBALS).toEqual({ a11y: { manual: true } });
  });

  it('says it once per document, not once per story', async () => {
    // Globals live in the preview, and the preview is not reloaded between
    // stories — that is the entire point of a session. Repeating this on every
    // story would be a round trip per subject for a setting that has not moved.
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStories(page, ['a--one', 'a--two', 'a--three'], { baseUrl: BASE, ...TIMING });

    expect(announced(preview)).toHaveLength(1);
  });

  it('says nothing at all when the caller asks for nothing', async () => {
    // The escape hatch, and it has to be complete: a project whose visual
    // baselines are *of* the a11y addon's highlights needs the preview left
    // exactly as it configured it.
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING, globals: {} });

    expect(announced(preview)).toEqual([]);
  });

  it('carries whatever globals the caller named instead', async () => {
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStory(page, 'a--one', {
      baseUrl: BASE,
      ...TIMING,
      globals: { theme: 'dark' },
    });

    expect(announced(preview)).toEqual([{ globals: { theme: 'dark' } }]);
  });

  it('says nothing to a preview it cannot speak to, rather than failing over it', async () => {
    // No channel is the channel-less path of ADR-0009: a story per navigation,
    // and no way to tell the preview anything. A session that treated that as an
    // error would turn a Storybook it can still photograph into a run that
    // reports nothing.
    const page = fakePage(null);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.storyId).toBe('a--one');
  });
});
