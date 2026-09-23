/**
 * Every document a test's browser context held, drained when the test is done
 * with it.
 *
 * A Playwright spec over a probed application destructures `page`, navigates,
 * clicks, asserts — and names nothing from this package. The crossings are in
 * the page all the same, and a recorder that drains only through `variance`
 * writes that spec as having entered nothing: the next `--since` skips it over
 * the very line it walked. So the drain belongs to the context, which every
 * browser test already has, and not to a fixture a spec may never ask for.
 *
 * Every frame of every page, because the document holding the application is
 * not always the top one. Storybook's manager runs the story in
 * `#storybook-preview-iframe` and has no collector of its own; a spec that
 * opens a second tab has two pages; neither is `page.mainFrame()`.
 *
 * A document the test **replaced** — a reload, a second `goto`, a frame the
 * application removed, a page closed or crashed before the end — took its
 * undrained crossings with it, and nothing here can drain it afterwards. The
 * owner is marked incomplete instead: a record that has not seen its own start
 * is never believed whole, so the next selection runs the spec rather than
 * skipping it on crossings that were lost.
 */

import type {
  BrowserContext,
  Fixtures,
  Frame,
  Page,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
  Request,
} from '@playwright/test';
import type { RecorderFixture } from './completed.js';
import { testOf } from './execution.js';

/**
 * The `context` fixture, wrapped when recording is on.
 *
 * An override rather than an automatic fixture of its own: it is set up only
 * when a test asks for a browser, and it is torn down after every `afterEach`
 * and every fixture that asked for a page, while the context is still open —
 * which is the last moment the crossings are readable and the first moment
 * they are all there.
 */
export const varianceDocumentFixtures: Fixtures<
  object,
  RecorderFixture,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  context: async ({ context, varianceRecorder }, use, testInfo) => {
    if (varianceRecorder === undefined) {
      await use(context);
      return;
    }
    const owner = varianceRecorder.owner(testInfo);
    const documents = watchDocuments(context);
    await use(context);
    documents.stop();
    let lost = documents.lost();
    for (const page of context.pages()) {
      for (const frame of page.frames()) {
        try {
          await varianceRecorder.note(frame, owner, testOf(testInfo));
        } catch {
          // A frame detached between listing and draining, or a document torn
          // down mid-evaluation: its window is gone, which is the same fact as
          // a reload and is recorded the same way.
          lost = true;
        }
      }
    }
    if (lost) varianceRecorder.mark(owner, false);
  },
};

interface Watch {
  /** Whether any document the test ran in was gone before it could be drained. */
  readonly lost: () => boolean;
  readonly stop: () => void;
}

/**
 * Count the documents each frame loaded, and notice the ones that went away.
 *
 * A navigation request is a new document: a hash change and `pushState` make
 * none, so a single-page application moving between its own routes, and
 * Storybook's manager switching stories, keep their realm and lose nothing. The
 * first request of a frame is the document the test opened; a second one
 * replaced it. A redirect is one document reached by two requests, and is
 * counted once.
 */
function watchDocuments(context: BrowserContext): Watch {
  const documents = new Map<Frame, number>();
  let lost = false;
  const loaded = (frame: Frame) => (documents.get(frame) ?? 0) > 0;

  const onRequest = (request: Request) => {
    if (!request.isNavigationRequest() || request.redirectedFrom() !== null) return;
    const frame = request.frame();
    const count = (documents.get(frame) ?? 0) + 1;
    documents.set(frame, count);
    if (count > 1) lost = true;
  };
  const onDetached = (frame: Frame) => {
    if (loaded(frame)) lost = true;
  };
  const onGone = (page: Page) => () => {
    if ([page.mainFrame(), ...page.frames()].some(loaded)) lost = true;
  };
  const watched = new Map<Page, { readonly gone: () => void }>();
  const onPage = (page: Page) => {
    const gone = onGone(page);
    watched.set(page, { gone });
    page.on('framedetached', onDetached);
    page.on('close', gone);
    page.on('crash', gone);
  };

  context.on('request', onRequest);
  context.on('page', onPage);
  for (const page of context.pages()) onPage(page);

  return {
    lost: () => lost,
    stop: () => {
      context.off('request', onRequest);
      context.off('page', onPage);
      for (const [page, { gone }] of watched) {
        page.off('framedetached', onDetached);
        page.off('close', gone);
        page.off('crash', gone);
      }
    },
  };
}
