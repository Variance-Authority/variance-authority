// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { collectStories, collectStory } from './preview.js';
import { BASE, TIMING, fakePage, fakePreview, type FakePreview } from './preview-fake.js';

/**
 * When a read is over, which is not when the story is on screen.
 *
 * `storyRendered` says the story function returned; Storybook is done with the
 * render one phase later, at `finished`. Between them sit `afterEach` and
 * anything an addon hangs off it — an axe scan, for a project with
 * `@storybook/addon-a11y` configured to test — and Storybook answers a switch
 * away from a render still in those phases by reloading the whole preview. That
 * discards everything injected into the page, so the cost is not a slow run but
 * a run that stops observing after the first slow story.
 *
 * Its own suite because the claims are about *waiting* and each one costs real
 * milliseconds: what is waited for, what is never waited for twice, and what is
 * said out loud when the wait is spent. The wait itself is in Node rather than
 * in the page function, for the reason `story-finished.ts` gives — the page's
 * clock belongs to whoever is testing.
 *
 * The fake preview they run against, and what a fake can and cannot prove, is in
 * `preview-fake.ts`. `cases/storybook-case/src/finish.chromium.test.js` is the
 * same claim against a Storybook nobody here wrote.
 */

let preview: FakePreview | null = null;

afterEach(() => {
  preview?.dispose();
  preview = null;
});

describe('the end of a render', () => {
  it('does not hand a story back until Storybook has finished with it', async () => {
    // `storyRendered` is not the end of a render: `afterEach`, reporting, and
    // anything an addon hangs off them run after it — an axe scan, for a project
    // with `@storybook/addon-a11y` configured to test. The driver's very next
    // act is to select the next story, and Storybook answers a switch away from
    // a render that is still pending by reloading the whole preview
    // (`StoryRender.teardown`), which discards everything injected into the
    // page. So the finish line is `storyFinished`, and this pins it: the fake
    // emits `storyRendered` at 1ms and `storyFinished` at 3ms, and a driver that
    // stopped at the first would come back having heard only one of them.
    preview = fakePreview({ 'a--one': 'renders' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('rendered');
    expect(preview.heard('storyFinished')).toBe(true);
  });

  it('stops waiting for a finish this preview has never been seen to emit', async () => {
    // Storybook before 8.3 does not emit `storyFinished` at all, and a driver
    // that waited for it there would add the readiness budget to every story of
    // every run. The wait is therefore paid once: the first story learns that
    // this preview is silent, and the second does not ask again.
    preview = fakePreview({ 'a--one': 'never-finishes', 'a--two': 'never-finishes' });
    const page = fakePage(preview);

    const first = Date.now();
    const one = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });
    const paid = Date.now() - first;

    const second = Date.now();
    const two = await collectStory(page, 'a--two', { baseUrl: BASE, ...TIMING });
    const again = Date.now() - second;

    expect(one.status).toBe('rendered');
    expect(two.status).toBe('rendered');
    expect(paid).toBeGreaterThanOrEqual(TIMING.timeoutMs);
    expect(again).toBeLessThan(TIMING.timeoutMs);
  });

  it('warns when a preview that does emit the event leaves one story unfinished', async () => {
    // The two silences are not the same silence. A preview that has never been
    // heard to finish anything is a Storybook older than 8.3, and warning about
    // that would put a line on every subject of every run. A preview that
    // finished the *last* story and not this one is a render genuinely stuck in
    // a later phase, and the stories after it are the ones at risk — Storybook
    // reloads the whole preview over it — so that one is worth saying out loud.
    preview = fakePreview({ 'a--one': 'renders', 'a--two': 'never-finishes' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[0]?.warnings).toEqual([]);
    expect(outcomes[1]?.status).toBe('rendered');
    expect(outcomes[1]?.warnings.join(' ')).toContain('storyFinished');
    expect(outcomes[1]?.warnings.join(' ')).toContain('read from a page that has been reset');
  });
  it('does not wait on a story the preview is already showing', async () => {
    // Reading one subject twice in the same page is how this tool separates an
    // order-dependent reading from a regression, and Storybook does not
    // re-render a story it is already showing — so the second read gets no
    // second `storyFinished`, because there is no second render. A driver that
    // only remembered what it heard would spend its whole budget waiting for an
    // event nobody is going to send, and then report a story sitting finished on
    // the screen as one stuck mid-phase. `isPending` is the same question
    // Storybook's own `teardown` asks, and a preview holding no pending render
    // is the state there is nothing to wait out.
    preview = fakePreview({ 'a--one': 'renders' });
    const page = fakePage(preview);

    await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    const started = Date.now();
    const again = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });
    const spent = Date.now() - started;

    expect(again.status).toBe('rendered');
    expect(again.warnings).toEqual([]);
    expect(spent).toBeLessThan(TIMING.timeoutMs);
  });

  it('says so when Storybook finished the render by reporting it failed', async () => {
    // A story can put its picture on screen and still fail: a `play` that threw
    // after the last paint, an `afterEach` that raised, a reporter that filed a
    // failure. The capture is of a real render, so calling the story unrendered
    // would throw away evidence that exists — but a subject whose own checks
    // failed is not one to write a baseline from without being told.
    preview = fakePreview({ 'a--one': 'finishes-badly' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('rendered');
    expect(outcome.warnings.join(' ')).toContain('status `error`');
  });

  it('stays quiet about a status it has never heard of', async () => {
    // Storybook's vocabulary is Storybook's. A build that adds a value to it
    // should reach a reader through the ordinary path, not put a line on every
    // subject of a run whose only sin is being newer than this adapter.
    preview = fakePreview({ 'a--one': 'renders' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.warnings).toEqual([]);
  });
});
