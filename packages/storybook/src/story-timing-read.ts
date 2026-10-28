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
 * `ready` goes to the first story asked about on the document, and every later
 * one reads 0: it was timed, and the document was already ready. `collect` is
 * the story's load, where the driver loaded it to read its parameters, plus its
 * last render's `preparing` to `loading`; the load is spent once, so the same
 * story read again at another width carries only its render. `cases` comes from
 * the story's last render: `cases` ends where it finished,
 * or failed, or — for one still in `afterEach` — rendered, and a render with
 * none of those has no end to measure to. A story read
 * again without a new render has only that 0 left to give.
 */
export const takeStoryTiming = (request: StoryTimingRequest): StoryTiming => {
  const record = (globalThis as unknown as Record<string, unknown>)[request.key] as
    | {
        ready?: number;
        claimed: boolean;
        renders: Record<string, { phases: Record<string, number>; last: string } | undefined>;
        loads?: Record<string, { start: number; end: number } | undefined>;
      }
    | undefined;
  if (record === undefined) return {};
  const timing: { ready?: number; collect?: number; cases?: number } = {};
  if (record.ready !== undefined) {
    timing.ready = record.claimed ? 0 : record.ready;
    record.claimed = true;
  }
  const load = record.loads?.[request.storyId];
  if (load !== undefined) {
    delete record.loads![request.storyId];
    timing.collect = load.end - load.start;
  }
  const render = record.renders[request.storyId];
  if (render === undefined) return timing;
  delete record.renders[request.storyId];
  const { preparing, loading } = render.phases;
  if (preparing !== undefined && loading !== undefined) timing.collect = (timing.collect ?? 0) + loading - preparing;
  const { finished, errored, aborted, completed } = render.phases;
  const end = finished ?? errored ?? aborted ?? completed;
  if (loading !== undefined && end !== undefined) timing.cases = end - loading;
  return timing;
};
