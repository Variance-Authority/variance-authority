import type { StoryTiming } from './story-timing.js';

/**
 * The driver's half of `story-timing.ts`, alone in its module because it is
 * serialized into the page and may close over nothing and import nothing but
 * types. The key arrives in the request.
 */

/** What {@link takeStoryTiming} reads. */
export interface StoryTimingRequest {
  readonly key: string;
  readonly storyId: string;
}

/**
 * Hand back what the page timed of one story, and forget it. **Runs in page
 * scope.**
 *
 * `ready` goes to the first story asked about on the document. `collect` and
 * `cases` come from the story's last render: `cases` ends where it finished,
 * or failed, or — for one still in `afterEach` — rendered, and a render with
 * none of those has no end to measure to. A story read
 * again without a new render has nothing left to give.
 */
export const takeStoryTiming = (request: StoryTimingRequest): StoryTiming => {
  const record = (globalThis as unknown as Record<string, unknown>)[request.key] as
    | {
        ready?: number;
        claimed: boolean;
        renders: Record<string, { phases: Record<string, number>; last: string } | undefined>;
      }
    | undefined;
  if (record === undefined) return {};
  const timing: { ready?: number; collect?: number; cases?: number } = {};
  if (!record.claimed && record.ready !== undefined) {
    record.claimed = true;
    timing.ready = record.ready;
  }
  const render = record.renders[request.storyId];
  if (render === undefined) return timing;
  delete record.renders[request.storyId];
  const { preparing, loading } = render.phases;
  if (preparing !== undefined && loading !== undefined) timing.collect = loading - preparing;
  const { finished, errored, aborted, completed } = render.phases;
  const end = finished ?? errored ?? aborted ?? completed;
  if (loading !== undefined && end !== undefined) timing.cases = end - loading;
  return timing;
};
