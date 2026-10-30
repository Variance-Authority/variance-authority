// compass: variance-authority.reach.story
/**
 * The stories cases that ran in a page carried to the runner's process on their
 * own result, written there as a case in Node writes its own.
 *
 * A page tapes, and the runner's setup module leaves each case's tape on the
 * case's `meta`, under {@link BROWSER_JOURNAL}; the runner sends `meta` with
 * the case's result. The names the case goes by are the result's, as the
 * record's are: the page carries the tape alone.
 */

import { BROWSER_JOURNAL, type PageStorySource } from './worker-source.js';
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

/**
 * What a page that tapes adds to its setup module, for either runner. Loaded
 * only where a page tapes: the tape's script reads the tap from the build.
 */
export async function pageTaping(): Promise<PageStorySource> {
  return { tape: (await import('../story/page.js')).storyPageSource(), hooks: carryingHooks() };
}

/** One case's end as its runner reports it: the names its result gives it, and its `meta`. */
export interface CaseEnd {
  readonly file?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly project?: string | undefined;
  readonly meta?: object | undefined;
  readonly stopped: boolean;
}

/**
 * Write the story each case that ran in a page carried on its `meta`, under
 * the names its result gives it, the names the record knows it by. A case in
 * Node writes its own, and carries none.
 *
 * A result that leaves the file or the name out names no case the record
 * knows, and writes no story. One that leaves the id out still does: the record
 * keeps an id-less case, and a story is found by its file and name.
 */
export async function writeCarriedStories(directory: string | undefined, ends: readonly CaseEnd[]): Promise<void> {
  if (directory === undefined) return;
  const carried = ends.flatMap(({ file, name, id, project, meta, stopped }) => {
    const held = carriedStory(meta);
    if (held === undefined || file === undefined || file === '' || name === undefined || name === '') return [];
    const subject: StoryCase = { file, name, id: id ?? name, project };
    return [{ subject, story: held.story, stopped }];
  });
  if (carried.length === 0) return;
  // Loaded here, where a page carried a story, and not at the top: it reads
  // the format from the build.
  const stories = (await import('../story/page.js')).pageStories(directory);
  for (const { subject, story, stopped } of carried) {
    stories.add(subject, story);
    stories.write(subject, stopped);
  }
}
