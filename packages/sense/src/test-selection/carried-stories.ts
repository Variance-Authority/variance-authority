/**
 * The stories cases that ran in a page carried to the runner's process on their
 * own result, written there as a case in Node writes its own.
 *
 * A page tapes, and the runner's setup module leaves each case's tape on the
 * case's `meta`, under {@link BROWSER_JOURNAL}; the runner sends `meta` with
 * the case's result. Which names the case goes by is the runner's to say: a
 * runner whose page knows them carries them beside the tape, and one whose
 * result names the case hands them here.
 */

import { BROWSER_JOURNAL } from './worker-source.js';
import type { PageStory, StoryCase } from '../story/page.js';

/** What a case in a page left on its `meta`: its tape, and the names the record knows it by when the page knew them. */
export type CarriedStory = Partial<StoryCase> & { readonly story: PageStory };

/** The tape a case's `meta` carries, if it carries one. */
export function carriedStory(meta: object | undefined): CarriedStory | undefined {
  const held = (meta as Record<string, unknown> | undefined)?.[BROWSER_JOURNAL] as CarriedStory | undefined;
  return typeof held?.story === 'object' && held.story !== null ? held : undefined;
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
