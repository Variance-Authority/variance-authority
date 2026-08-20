// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  STORYBOOK_ERROR_OVERLAY,
  STORYBOOK_EVENTS,
  collectStories,
  collectStory,
  harnessPage,
  showStory,
  type ShowRequest,
  type StoryOutcome,
} from './preview.js';
import {
  BASE,
  TIMING,
  fakePage,
  fakePreview,
  ship,
  type FakePage,
  type FakePreview,
} from './preview-fake.js';

/**
 * What one navigation buys, and what a failing story costs.
 *
 * The claims this module exists to make: N stories cost one navigation, a story
 * is switched over Storybook's own channel rather than by URL, listeners do not
 * outlive the story they were attached for, and every way a preview can fail
 * comes back as an outcome with the rest of the run still ahead of it.
 *
 * The fake Storybook they all run against — and the careful account of what a
 * fake can and cannot prove — is in `preview-fake.ts`. The declared-readiness
 * ladder has its own suite in `preview-readiness.test.ts`, and the URL rules,
 * which need no DOM at all, in `preview-url.test.ts`.
 */

let preview: FakePreview | null = null;

afterEach(() => {
  preview?.dispose();
  preview = null;
});

describe('showing stories on one page', () => {
  it('navigates once, however many stories follow', async () => {
    // Acceptance 3, and the reason this module exists: a reload per story is the
    // per-subject setup cost ADR-0009 refuses to pay.
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two', 'a--three'], {
      baseUrl: BASE,
      ...TIMING,
    });

    expect(page.navigations).toHaveLength(1);
    expect(outcomes.map((outcome) => outcome.navigated)).toEqual([true, false, false]);
    expect(outcomes.every((outcome) => outcome.status === 'rendered')).toBe(true);
  });

  it('switches stories over the channel rather than by URL', async () => {
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(preview.emitted).toEqual([
      { event: 'setCurrentStory', payload: { storyId: 'a--two', viewMode: 'story' } },
    ]);
  });

  it('does not re-select the story the URL already chose', async () => {
    // Re-emitting would re-render a story that is sitting finished on the
    // screen, which is a second render nobody asked for and a chance to observe
    // the wrong one of the two.
    preview = fakePreview({ 'a--one': 'silent' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(preview.emitted).toEqual([]);
    expect(outcome.status).toBe('rendered');
    expect(outcome.readiness).toBe('already-rendered');
  });

  it('reports Storybook’s own signal when it is the one that fired', async () => {
    // The distinction the whole result type exists for: this readiness knows
    // about decorators and loaders, and the fallback does not.
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[1]?.readiness).toBe('storyRendered');
    expect(outcomes[1]?.warnings).toEqual([]);
  });

  it('names the element the story mounted into', async () => {
    // The subject root, and the reason Storybook's chrome never reaches the
    // subject: the preview reset and the addon layout are outside this subtree,
    // so applicability pruning drops them for the ordinary reason (ADR-0003).
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });
    expect(outcome.root).toBe('#storybook-root');
  });

  it('removes its listeners between stories', async () => {
    // The page is never reloaded, so a handler left attached would answer for
    // the next story as well — and the first story's outcome would be decided
    // by the second story's event.
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStories(page, ['a--one', 'a--two', 'a--three'], { baseUrl: BASE, ...TIMING });

    expect(preview.listeners()).toBe(0);
  });
});

describe('a story that fails is a subject, not a crashed run', () => {
  it('reports a throwing render and observes the stories after it', async () => {
    // Acceptance 4. The failure this guards against is a suite that stops at the
    // fourth of three hundred subjects and reports nothing about the rest.
    preview = fakePreview({ 'a--two': 'exception' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two', 'a--three'], {
      baseUrl: BASE,
      ...TIMING,
    });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'errored', 'rendered']);
    expect(outcomes[1]?.error).toEqual({
      from: 'story',
      message: 'a--two threw',
      stack: 'at Story',
    });
  });

  it('catches a render that throws back out of the channel emit', async () => {
    // Storybook dispatches synchronously. Unhandled, this rejects the evaluate
    // and takes the whole run with it.
    preview = fakePreview({ 'a--two': 'throws-on-select' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[1]?.status).toBe('errored');
    expect(outcomes[1]?.error?.from).toBe('story');
    expect(outcomes[1]?.error?.message).toContain('exploded while rendering');
  });

  it('reports a story the preview does not have as missing, not as unchanged', async () => {
    // The index and the built preview disagreeing is a real and quiet failure:
    // one of them is stale, and a subject that silently observes nothing would
    // report the same as one that observed no change.
    preview = fakePreview({ 'a--two': 'missing' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[1]?.status).toBe('missing');
    expect(outcomes[1]?.error?.message).toContain('stale');
  });

  it('reads the preview’s error overlay when there is no event to carry the error', async () => {
    // A story that throws during the very first load errors before anything is
    // listening; all that is left is what the preview drew on the screen.
    preview = fakePreview({ 'a--one': 'overlay' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('errored');
    expect(outcome.error?.message).toContain('could not be rendered');
  });

  it('refuses to call a story rendered when nothing mounted', async () => {
    // An unobservable subject reported as observed is a false `unchanged`
    // waiting to happen, so an empty root is its own status.
    preview = fakePreview({ 'a--one': 'empty' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('no-root');
    expect(outcome.root).toBeUndefined();
  });

  it('reports a story that never settles as a timeout, not as a render', async () => {
    preview = fakePreview({ 'a--one': 'never-settles' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('timeout');
    expect(outcome.error?.message).toContain('still changing');
  });

  it('blames the page, not the component, when the browser cannot be driven', async () => {
    // An agent handed `errored` for a closed page goes looking for a visual
    // regression in code that is fine.
    const page: FakePage = {
      navigations: [],
      url: () => 'about:blank',
      goto: async () => {
        throw new Error('Target page, context or browser has been closed');
      },
      evaluate: async () => {
        throw new Error('unreachable');
      },
    };

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('unreachable');
    expect(outcome.error?.from).toBe('page');
    expect(outcome.error?.message).toContain('could not be driven');
  });

  it('blames the observer when the story rendered and the capture threw', async () => {
    // One unserializable capture must not cost the other 299 observations, and
    // must not be filed as a defect in the story that rendered fine.
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], {
      baseUrl: BASE,
      ...TIMING,
      observe: (outcome: StoryOutcome): void => {
        if (outcome.storyId === 'a--one') throw new Error('collector bundle missing');
      },
    });

    expect(outcomes[0]?.status).toBe('errored');
    expect(outcomes[0]?.error?.from).toBe('observer');
    expect(outcomes[1]?.status).toBe('rendered');
  });

  it('observes only the stories that rendered', async () => {
    // Capturing after a failed render would read the *previous* story's markup
    // under this story's id: a baseline that never corresponded to anything.
    preview = fakePreview({ 'a--two': 'exception' });
    const page = fakePage(preview);
    const observed: string[] = [];

    await collectStories(page, ['a--one', 'a--two', 'a--three'], {
      baseUrl: BASE,
      ...TIMING,
      observe: (outcome: StoryOutcome): void => {
        observed.push(outcome.storyId);
      },
    });

    expect(observed).toEqual(['a--one', 'a--three']);
  });
});

describe('a preview with no channel', () => {
  it('falls back to markup quiescence and says that is what it did', async () => {
    // The fallback is weaker evidence, not equivalent evidence. A caller that
    // cannot tell the two apart cannot know that a capture may be of a story
    // still waiting on a fetch.
    preview = fakePreview({ 'a--one': 'silent' }, false);
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('rendered');
    expect(outcome.readiness).toBe('markup-quiescent');
    expect(outcome.channel).toBe(false);
    expect(outcome.warnings.join(' ')).toContain('no Storybook channel');
  });

  it('pays a reload per story, and reports that it paid one', async () => {
    // Without a channel there is no way to switch stories in place. The cost is
    // real and the run's economics are not what its owner thinks unless it says so.
    preview = fakePreview({ 'a--one': 'silent', 'a--two': 'silent' }, false);
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(page.navigations).toHaveLength(2);
    expect(outcomes[1]?.navigated).toBe(true);
    expect(outcomes[1]?.warnings.join(' ')).toContain('ADR-0009');
  });
});

describe('the page function', () => {
  it('survives being rebuilt from its own source, as Playwright rebuilds it', async () => {
    // The constraint that cannot be seen in a type check: a page function may
    // close over nothing. Every constant it needs arrives in the request.
    preview = fakePreview({ 'a--one': 'silent' });
    preview.select('a--one');

    const result = await ship(showStory)({
      storyId: 'a--one',
      timeoutMs: 80,
      pollMs: 5,
      events: {
        setCurrentStory: 'setCurrentStory',
        storyRendered: 'storyRendered',
        storyThrewException: 'storyThrewException',
        storyErrored: 'storyErrored',
        storyMissing: 'storyMissing',
        playFunctionThrewException: 'playFunctionThrewException',
      },
      roots: ['#storybook-root', '#root'],
      errorOverlay: { bodyClass: 'sb-show-errordisplay', message: '#error-message', stack: '#error-stack' },
    });

    expect(result.status).toBe('rendered');
    expect(result.channel).toBe(true);
  });
});

/**
 * The two ends of the seam: what the driver ships, and what it drives.
 *
 * Both are configuration that looks like a constant. The event names and the
 * overlay selectors belong to a package this one does not depend on, and
 * `harnessPage` is the whole of the browser dependency — six lines that must
 * keep matching a `Page` nothing here imports.
 */
describe('the protocol defaults, and the page they are shipped to', () => {
  it('ships the documented event names and overlay in the request, not around it', async () => {
    preview = fakePreview({});
    const page = fakePage(preview);
    let sent: ShowRequest | undefined;

    await collectStory(
      { ...page, evaluate: (fn, request) => { sent = request; return page.evaluate(fn, request); } },
      'a--one',
      { baseUrl: BASE, ...TIMING },
    );

    // Carried by value because the function that reads them is serialized into
    // the page: a module constant referenced from page scope is a
    // `ReferenceError` in a headless browser, where nobody sees it.
    expect(sent?.events).toEqual(STORYBOOK_EVENTS);
    expect(sent?.errorOverlay).toEqual(STORYBOOK_ERROR_OVERLAY);
  });

  it('pins the harness page to the one navigation policy this adapter has', async () => {
    const calls: { readonly url: string; readonly options: unknown }[] = [];
    const page = harnessPage({
      page: {
        url: () => 'about:blank',
        goto: async (url, options) => {
          calls.push({ url, options });
          return null;
        },
        evaluate: async <A, R>(fn: (argument: A) => R | Promise<R>, argument: A) => fn(argument),
      },
    });

    await page.goto(`${BASE}/iframe.html`);

    // `load` rather than the caller's choice, and the same one the harness used
    // for its own navigation — two readiness policies in one page is one of them
    // being wrong about when a story exists.
    expect(calls).toEqual([{ url: `${BASE}/iframe.html`, options: { waitUntil: 'load' } }]);
    expect(page.url()).toBe('about:blank');
  });
});
