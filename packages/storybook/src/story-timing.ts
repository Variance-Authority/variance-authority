/**
 * Where the browser spent a story, on the page's own clock.
 *
 * A Playwright test that drives a preview measures nothing about the code under
 * test: the story's code runs in the page, and the round trips back to Node are
 * the driver's. So the page times itself, from Storybook's own signals, and the
 * driver reads the answer back after each story.
 *
 * Three figures, kept apart because they answer different questions:
 *
 * - `ready`: the document's start until the preview's store is initialized —
 *   the runtime, the project annotations, the index. Paid once per document,
 *   so it belongs to the first story read on it, and a story the preview
 *   switched to over the channel carries 0, as a second test in one file
 *   pays no worker start.
 * - `collect`: from the render's `preparing` phase to its `loading`: importing
 *   the story's file with everything it loads, and then unmounting the story
 *   shown before it, which Storybook does in between and signals nothing for.
 * - `cases`: from `loading` to the render's last phase — loaders,
 *   `beforeEach`, the render, the play function and `afterEach`.
 *
 * {@link watchStoryTiming} runs at document start and only writes stamps down;
 * `takeStoryTiming`, in `story-timing-read.ts`, is serialized into the page by
 * the driver to read them back, which is why it has a module of its own.
 */

/** Where the stamps live on the page, read by the driver and shipped in the request. */
export const STORY_TIMING_KEY = '__variance_authority_story_timing__';

/** Milliseconds the page spent on one story, each absent where the page saw no edge of it. */
export interface StoryTiming {
  readonly ready?: number;
  readonly collect?: number;
  readonly cases?: number;
}

/** The stamps one document holds: when the preview was ready, and each story's render phases. */
interface StoryTimingRecord {
  ready?: number;
  claimed: boolean;
  readonly renders: Record<string, { readonly phases: Record<string, number>; last: string }>;
}

interface PreviewLike {
  readonly ready?: () => Promise<unknown>;
  readonly channel?: { on(event: string, handler: (payload: unknown) => void): void };
}

/**
 * Start stamping on this document. **Runs in page scope, before the page's own
 * scripts.**
 *
 * The preview assigns itself to `__STORYBOOK_PREVIEW__` in its constructor, with
 * its channel and its store promise already made, so an accessor there sees it
 * the moment it exists and hands the property back as plain data. The clock is
 * the one the document had at its start: a story that fakes `performance` later
 * fakes its own figures, not these.
 */
export function watchStoryTiming(key: string = STORY_TIMING_KEY): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[key] !== undefined) return;
  const now = performance.now.bind(performance);
  const record: StoryTimingRecord = { claimed: false, renders: {} };
  scope[key] = record;

  const observe = (preview: unknown): void => {
    if (typeof preview !== 'object' || preview === null) return;
    const { ready, channel } = preview as PreviewLike;
    if (typeof ready === 'function') {
      ready.call(preview).then(
        () => {
          record.ready ??= now();
        },
        () => {},
      );
    }
    channel?.on('storyRenderPhaseChanged', (payload: unknown) => {
      const { newPhase, storyId } = (payload ?? {}) as { newPhase?: unknown; storyId?: unknown };
      if (typeof newPhase !== 'string' || typeof storyId !== 'string') return;
      // A new render of a story starts its stamps over: the last one is the one
      // the driver waited for.
      if (newPhase === 'preparing') record.renders[storyId] = { phases: {}, last: newPhase };
      const render = record.renders[storyId];
      if (render === undefined) return;
      render.phases[newPhase] ??= now();
      render.last = newPhase;
    });
  };

  const existing = scope.__STORYBOOK_PREVIEW__;
  if (existing !== undefined) {
    observe(existing);
    return;
  }
  Object.defineProperty(globalThis, '__STORYBOOK_PREVIEW__', {
    configurable: true,
    enumerable: true,
    get: () => undefined,
    set: (value: unknown) => {
      Object.defineProperty(globalThis, '__STORYBOOK_PREVIEW__', {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
      observe(value);
    },
  });
}
