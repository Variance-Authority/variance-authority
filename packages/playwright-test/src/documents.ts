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
  TestInfo,
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
    // Before any page loads, so the collector a page evaluates finds the tape.
    // FIXME: a context the spec makes itself, with `browser.newContext()`, gets
    // no tape, and a document the test replaced took its undrained tape with
    // it: the story says nothing of either.
    if (varianceRecorder.storyPage !== undefined) await context.addInitScript(varianceRecorder.storyPage);
    const documents = watchDocuments(context);
    const statements = drainEachStatement(context, varianceRecorder, owner, testInfo);
    await use(context);
    documents.stop();
    const { line, hook, stalled } = await statements.stop();
    // A page that held the statements' drain holds this one too, and the test's
    // timeout is all that would end it: the case is not believed whole instead.
    let lost = documents.lost() || stalled;
    if (line !== undefined) varianceRecorder.cut?.(owner, testOf(testInfo), line, hook);
    for (const page of stalled ? [] : context.pages()) {
      for (const frame of page.frames()) {
        try {
          await varianceRecorder.note(frame, owner, testOf(testInfo), line, hook);
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

/**
 * How long a statement waits for the documents to be drained before it goes on
 * without them. A drain is one evaluation per frame and takes milliseconds; one
 * that takes longer is held up by the page — an open `alert` blocks every
 * evaluation until the test answers it, and the statement that would answer it
 * is the one waiting.
 */
const STATEMENT_WAIT_MS = 1000;

interface Statements {
  /**
   * Stop draining per statement; resolves to the line the rest is charged to,
   * and whether the page held the last drain past {@link STATEMENT_WAIT_MS}.
   */
  readonly stop: () => Promise<{ readonly line: number | undefined; readonly hook: boolean; readonly stalled: boolean }>;
}

/** Whether `work` settles within {@link STATEMENT_WAIT_MS}. */
function settlesInTime(work: Promise<void>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), STATEMENT_WAIT_MS);
    timer.unref();
    void work.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Drain every document before each statement of the running spec, so each
 * region its case entered is charged to the test line whose statement first
 * reached it.
 *
 * The spec was compiled with the cadence plugin ([`cadence-babel.cts`](./cadence-babel.cts)),
 * which awaits what `__VA__.c(line, file, hook)` returns before each statement
 * of an async test or hook body; what a hook's statement reached first is
 * ambient, as in Node. A spec compiled without the plugin never calls this, and
 * all it reached is ambient. A body declared in another file names that file
 * and is not waited on: the spec's statement that called it is charged.
 *
 * A drain that does not finish in {@link STATEMENT_WAIT_MS} leaves the case's
 * lines from there on unknown: every region drained after it is ambient,
 * because which statement reached it is no longer known. A drain that fails is
 * passed over — a document that went away is the document watch's to report,
 * and the teardown drain is the one that decides.
 */
function drainEachStatement(
  context: BrowserContext,
  recorder: NonNullable<RecorderFixture['varianceRecorder']>,
  owner: string,
  testInfo: TestInfo,
): Statements {
  type Cut = (line: number, file: string, hook: boolean) => unknown;
  const realm = globalThis as { __VA__?: { c?: Cut } };
  const held = realm.__VA__;
  const outer = held?.c;
  const subject = testOf(testInfo);
  let last: { line: number; hook: boolean } | undefined;
  let late = false;
  let draining: Promise<void> = Promise.resolve();

  const drain = (reached: { line: number; hook: boolean } | undefined) => async () => {
    if (reached !== undefined && !late) recorder.cut?.(owner, subject, reached.line, reached.hook);
    for (const page of context.pages()) {
      for (const frame of page.frames()) {
        try {
          await recorder.note(frame, owner, subject, late ? undefined : reached?.line, reached?.hook);
        } catch {
          // Answered by the document watch and the teardown drain.
        }
      }
    }
  };
  const c: Cut = (line, file, hook) => {
    const theirs = outer?.(line, file, hook);
    // Once a drain was late no statement records its line, so none waits on
    // the held drain again: the teardown drain reads what they reached.
    if (file !== testInfo.file || late) return theirs;
    const reached = last;
    last = { line, hook };
    draining = draining.then(drain(reached));
    const waited = settlesInTime(draining).then((inTime) => {
      if (!inTime) late = true;
    });
    return theirs === undefined || theirs === null ? waited : Promise.all([theirs, waited]);
  };

  if (held === undefined) realm.__VA__ = { c };
  else held.c = c;

  return {
    stop: async () => {
      if (held === undefined) delete realm.__VA__;
      else if (outer === undefined) delete held.c;
      else held.c = outer;
      const stalled = !(await settlesInTime(draining));
      if (stalled) late = true;
      return { line: late ? undefined : last?.line, hook: !late && last?.hook === true, stalled };
    },
  };
}

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
