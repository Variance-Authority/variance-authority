import { markFinishAbsent, readFinishRecord } from './story-finished.js';
import { FINISHED_RECORD_KEY, type ShowRequest } from './preview-protocol.js';
import type { StoryPage } from './preview.js';

/**
 * The driver's half of the finish watch: the waiting, and what is said about it.
 *
 * Its own module because the page's half is its own module for a reason — a
 * function that is serialized into a browser may close over nothing — and
 * keeping the Node half beside it makes the seam visible from both sides.
 * `story-finished.ts` writes down what the preview said; everything here reads
 * that back, decides when to stop asking, and turns the answer into a sentence
 * an adopter can act on.
 *
 * The type import of `StoryPage` points back at `preview.ts` and is erased at
 * compile time, so the cycle it looks like is not one at runtime.
 */

/**
 * Wait for Storybook to be done with the story that was just handed back.
 *
 * A read is over when the driver has the result, and the driver's very next act
 * is to select the next story. If this render is still between `storyRendered`
 * and `finished` at that moment, Storybook gives it three macrotask ticks to
 * stop and then reloads the entire preview (`StoryRender.teardown`), which
 * discards everything injected into the page — so every story after this one is
 * read from a document that has been reset. The wait is what makes the switch
 * safe, and it is *here*, in Node, rather than in the page function, because the
 * page's clock belongs to whoever is testing: a project that pinned it with
 * `page.clock.install` would have a grace timer scheduled in page scope that
 * never fires. See `story-finished.ts`.
 *
 * Only a rendered result waits. A story that threw, timed out or is missing has
 * nothing left to finish, and holding those back would pay the grace on the
 * subjects least able to afford it. Neither does a story the preview is already
 * showing: it was handed back by a render that has already finished, and
 * `story-finished.ts` keeps that answer rather than asking for it twice.
 *
 * Returns a warning when the render finished badly, and another when the wait was
 * spent and the preview *does* emit the
 * event for other stories — that is a render genuinely stuck, and the stories
 * after it are at risk. A preview never seen to emit it is a Storybook older
 * than 8.3, which is written down on the page so no later story of the session
 * pays this wait again, and is not worth a warning on every subject.
 */
export async function awaitFinish(page: StoryPage, request: ShowRequest): Promise<string | undefined> {
  const deadline = Date.now() + request.timeoutMs;
  let record = await page.evaluate(readFinishRecord, FINISHED_RECORD_KEY);

  while (record !== null && !record.absent && !record.hit && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, request.pollMs));
    record = await page.evaluate(readFinishRecord, FINISHED_RECORD_KEY);
  }

  if (record === null || record.absent) return undefined;

  if (record.hit) return failedFinish(record.status, request.events.storyFinished);

  if (!record.seen) {
    await page.evaluate(markFinishAbsent, FINISHED_RECORD_KEY);
    return undefined;
  }

  return (
    `the story rendered, but no \`${request.events.storyFinished}\` arrived within ` +
    `${request.timeoutMs}ms, and this preview has emitted that event for other stories. Storybook ` +
    `reloads the whole preview when a render it is replacing is still pending, so the ` +
    `stories after this one may be read from a page that has been reset.`
  );
}

/**
 * What a finish that arrived said about the render it ended.
 *
 * A story can render its picture and still have failed: `play` throwing after
 * the last paint, an `afterEach` that raised, a reporter that filed a failure.
 * Storybook carries that on the finish as `status`, and this adapter's answer is
 * a warning rather than a status of its own. The picture is real — it is on the
 * screen and a capture of it is a capture of what the component did — so calling
 * the story unrendered would throw away evidence that exists. But a subject
 * whose own checks failed is not a subject anybody should be told is fine, and a
 * baseline written from it is a baseline of a broken state.
 *
 * Nothing but `error` is reported. `success` is the ordinary case, and a value
 * this adapter has never heard of is somebody else's vocabulary — passing it
 * through as a warning would put a line on every subject of a Storybook whose
 * only sin is being newer than this file.
 */
function failedFinish(status: string | null, event: string): string | undefined {
  if (status !== 'error') return undefined;

  return (
    `Storybook rendered this story and then reported \`${event}\` with status \`error\`: its ` +
    'play function, an `afterEach`, or a reporter failed after the picture was on screen. The ' +
    'capture is of a real render, but the story did not pass its own checks.'
  );
}
