import type { ParametersRead } from './parameters.js';

/** What {@link loadStoryParameters} reads. */
export interface ParametersRequest {
  /** The namespace under `parameters` to hand back. */
  readonly key: string;
  readonly storyId: string;
  /** Where the page's story timing lives, so the load is charged to the story. */
  readonly timingKey: string;
}

/**
 * One story's own `parameters.<key>`, loaded the way the preview loads it to
 * render. **Runs in page scope.**
 *
 * The built index carries tags and no parameters, because parameters live in
 * the story modules and the index is written without evaluating them. So the
 * story's module is imported here, through `preview.loadStory` — the store's own
 * load, cached per file, which `showStory` would have triggered a moment later —
 * and the story comes back with its parameters merged from `preview.ts`, the
 * component's meta and the story, the merge Storybook renders with. Nothing but
 * this story's file is imported: a run reaches a file when it reaches the file's
 * first story, and not before.
 *
 * The load is stamped into the page's story timing under `loads`, apart from the
 * render's phases, because the render that follows starts its stamps over. The
 * driver adds it to the story's `collect`, so the first story read from a file
 * carries that file's import.
 *
 * Serialized to source text and evaluated in page scope, so it may close over
 * nothing and import nothing but types. Only the one namespace crosses back,
 * through JSON, so a parameter elsewhere in the object holding a component or a
 * function costs nothing.
 */
export const loadStoryParameters = async (request: ParametersRequest): Promise<ParametersRead> => {
  const scope = globalThis as unknown as Record<string, unknown>;
  const preview = scope.__STORYBOOK_PREVIEW__ as
    | {
        ready?: () => Promise<unknown>;
        loadStory?: (story: { storyId: string }) => Promise<{ parameters?: Record<string, unknown> }>;
      }
    | undefined;

  if (preview?.loadStory === undefined) {
    return { unsupported: 'the preview has no `__STORYBOOK_PREVIEW__.loadStory`, which Storybook 7 and later provide' };
  }

  try {
    if (preview.ready !== undefined) await preview.ready();
    const timing = scope[request.timingKey] as
      | { now: () => number; loads?: Record<string, { start: number; end: number }> }
      | undefined;
    const start = timing?.now();
    const story = await preview.loadStory({ storyId: request.storyId });
    if (timing !== undefined && start !== undefined) {
      (timing.loads ??= {})[request.storyId] = { start, end: timing.now() };
    }
    const value = story.parameters?.[request.key];
    return value === undefined ? {} : { parameters: JSON.parse(JSON.stringify(value)) as unknown };
  } catch (error) {
    return {
      unread: `the preview could not load the story: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
