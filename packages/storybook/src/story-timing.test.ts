// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_TIMING_KEY, watchStoryTiming } from './story-timing.js';
import { takeStoryTiming } from './story-timing-read.js';

/**
 * The page timing itself against a preview built the way Storybook 9 builds
 * one: its channel and its store promise made in the constructor, then the
 * instance assigned to `__STORYBOOK_PREVIEW__`. The watch is installed first,
 * as the page agent installs it at document start.
 */

let clock = 0;
const scope = globalThis as unknown as Record<string, unknown>;

function preview() {
  const listeners: ((payload: unknown) => void)[] = [];
  let ready!: () => void;
  const store = new Promise<void>((resolve) => (ready = resolve));
  const instance = {
    channel: { on: (_event: string, handler: (payload: unknown) => void) => void listeners.push(handler) },
    ready: () => store,
  };
  return {
    instance,
    initialize: async (at: number) => {
      clock = at;
      ready();
      await store;
    },
    phase: (at: number, storyId: string, newPhase: string) => {
      clock = at;
      for (const listener of listeners) listener({ newPhase, storyId, renderId: 1 });
    },
  };
}

const take = (storyId: string) => takeStoryTiming({ key: STORY_TIMING_KEY, storyId });

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete scope[STORY_TIMING_KEY];
  delete scope.__STORYBOOK_PREVIEW__;
});

describe('story timing', () => {
  it('gives the preview load to the first story, the story file to collect and the render to cases', async () => {
    watchStoryTiming();
    const page = preview();
    scope.__STORYBOOK_PREVIEW__ = page.instance;
    expect(scope.__STORYBOOK_PREVIEW__).toBe(page.instance);

    await page.initialize(900);
    page.phase(910, 'price--premium', 'preparing');
    page.phase(950, 'price--premium', 'loading');
    page.phase(955, 'price--premium', 'rendering');
    page.phase(960, 'price--premium', 'completed');
    page.phase(962, 'price--premium', 'afterEach');
    page.phase(970, 'price--premium', 'finished');
    expect(take('price--premium')).toEqual({ ready: 900, collect: 40, cases: 20 });

    // Switched to over the channel: the document was already ready, so the
    // story was timed and paid nothing for it.
    page.phase(1000, 'price--plain', 'preparing');
    page.phase(1005, 'price--plain', 'loading');
    page.phase(1008, 'price--plain', 'finished');
    expect(take('price--plain')).toEqual({ ready: 0, collect: 5, cases: 3 });

    // Read again with no new render, only the load it did not pay is left.
    expect(take('price--plain')).toEqual({ ready: 0 });
  });

  it('ends a render still in afterEach where it rendered, and leaves a running one without cases', async () => {
    watchStoryTiming();
    const page = preview();
    scope.__STORYBOOK_PREVIEW__ = page.instance;
    page.phase(10, 'a', 'preparing');
    page.phase(30, 'a', 'loading');
    page.phase(40, 'a', 'completed');
    page.phase(41, 'a', 'afterEach');
    page.phase(50, 'b', 'preparing');
    page.phase(55, 'b', 'loading');
    page.phase(56, 'b', 'rendering');
    expect([take('a'), take('b')]).toEqual([{ collect: 20, cases: 10 }, { collect: 5 }]);
  });

  it('starts a story over when the preview renders it again', () => {
    watchStoryTiming();
    const page = preview();
    scope.__STORYBOOK_PREVIEW__ = page.instance;
    page.phase(10, 'a', 'preparing');
    page.phase(90, 'a', 'loading');
    page.phase(100, 'a', 'preparing');
    page.phase(102, 'a', 'loading');
    page.phase(105, 'a', 'finished');
    expect(take('a')).toEqual({ collect: 2, cases: 3 });
  });

  it('observes a preview that already exists', async () => {
    const page = preview();
    scope.__STORYBOOK_PREVIEW__ = page.instance;
    watchStoryTiming();
    await page.initialize(300);
    expect(take('a')).toEqual({ ready: 300 });
  });

  it('answers nothing on a page that was never watched', () => {
    expect(take('a')).toEqual({});
  });
});
