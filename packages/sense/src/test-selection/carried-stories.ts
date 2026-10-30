/**
 * The stories cases that ran in a page carried to the runner's process on their
 * own result, written there as a case in Node writes its own.
 *
 * A page tapes, and the runner's setup module leaves each case's tape on the
 * case's `meta`, under {@link BROWSER_JOURNAL}; the runner sends `meta` with
 * the case's result. The names the case goes by are the result's, as the
 * record's are: the page carries the tape alone.
 */

import { BROWSER_JOURNAL } from './worker-source.js';
import type { PageStory, StoryCase } from '../story/page.js';

/** What a case in a page left on its `meta`: its tape. */
export interface CarriedStory {
  readonly story: PageStory;
}

/** The tape a case's `meta` carries, if it carries one. */
export function carriedStory(meta: object | undefined): CarriedStory | undefined {
  const held = (meta as Record<string, unknown> | undefined)?.[BROWSER_JOURNAL] as CarriedStory | undefined;
  return typeof held?.story === 'object' && held.story !== null ? held : undefined;
}

/**
 * The hooks a page's setup module adds to leave each case's tape on its own
 * context's `meta`. What runs between two cases is taken and dropped, so a
 * case's story opens at its first hook.
 *
 * The hooks name no parameter, for the reason the setup's `afterAll` does; the
 * context's `task` is the case.
 */
export function carryingHooks(): string {
  return `
beforeEach(() => { execution.story?.(); });
afterEach(function () {
  const task = arguments[0]?.task;
  const story = execution.story?.();
  if (task === undefined || story === undefined) return;
  (task.meta ??= {})[${JSON.stringify(BROWSER_JOURNAL)}] = { story };
});`;
}

/** Write the story of each case that carried one; a case in Node writes its own, and carries none. */
export async function writeCarriedStories(
  directory: string | undefined,
  carried: readonly { readonly subject: StoryCase; readonly story: PageStory; readonly stopped: boolean }[],
): Promise<void> {
  if (directory === undefined || carried.length === 0) return;
  // Loaded here, where a page carried a story, and not at the top: it reads
  // the format from the build.
  const stories = (await import('../story/page.js')).pageStories(directory);
  for (const { subject, story, stopped } of carried) {
    stories.add(subject, story);
    stories.write(subject, stopped);
  }
}
