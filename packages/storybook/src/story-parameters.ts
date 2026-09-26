import type { ParametersRead } from './parameters.js';

/**
 * Every story's own `parameters.<key>`, read from the running preview.
 *
 * The built index carries tags and no parameters, because parameters live in
 * the story modules and the index is written without evaluating them. The
 * preview has evaluated them: `extract()` loads every CSF file and returns each
 * story with its parameters already merged from `preview.ts`, the component's
 * meta and the story, which is the merge Storybook itself renders with.
 *
 * Serialized to source text and evaluated in page scope, so it may close over
 * nothing and import nothing but types; the key arrives in the argument. Only
 * that one namespace crosses back, through JSON, so a parameter elsewhere in the
 * object holding a component or a function costs nothing.
 */
export const readStoryParameters = async (key: string): Promise<ParametersRead> => {
  const preview = (
    window as unknown as {
      __STORYBOOK_PREVIEW__?: {
        ready?: () => Promise<unknown>;
        extract?: () => Promise<Record<string, { parameters?: Record<string, unknown> }>>;
      };
    }
  ).__STORYBOOK_PREVIEW__;

  if (preview?.extract === undefined) {
    return { unread: 'the preview has no `__STORYBOOK_PREVIEW__.extract`, which Storybook 7 and later provide' };
  }

  try {
    if (preview.ready !== undefined) await preview.ready();
    const stories = await preview.extract();
    const parameters: Record<string, unknown> = {};
    for (const [id, story] of Object.entries(stories)) {
      const value = story.parameters?.[key];
      if (value !== undefined) parameters[id] = JSON.parse(JSON.stringify(value)) as unknown;
    }
    return { parameters };
  } catch (error) {
    return {
      unread: `the preview could not list its stories: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
