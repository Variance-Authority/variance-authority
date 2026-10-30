/**
 * Every document a test's browser contexts held, drained when the test is done
 * with them.
 *
 * A Playwright spec over a probed application names nothing from this package,
 * yet its crossings are in the page; a recorder that drains only through
 * `variance` writes it as having entered nothing, and the next `--since` skips
 * it over the very line it walked. So every context the test makes is drained —
 * the runner's `context`, and one the spec opens with `browser.newContext()` —
 * and every frame of every page, because the application is not always in the
 * top one: Storybook runs it in `#storybook-preview-iframe`.
 *
 * A document the test replaced, or one that went away before the end, took its
 * undrained crossings with it. The owner is marked incomplete instead, so the
 * next selection runs the spec rather than skipping it on crossings lost.
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
import { format } from 'node:util';
import type { RecorderFixture } from './completed.js';
import { testOf } from './execution.js';

export interface VarianceDocumentFixtures {
  /**
   * Nothing a test reads. It is here to adopt every context the test makes,
   * and to drain them when the test is done.
   */
  readonly varianceDocuments: void;
}

let warned = false;
function unheard(): void {
  if (warned) return;
  warned = true;
  console.warn(
    'variance-authority: this Playwright client has no context instrumentation; ' +
      'a context a spec makes itself is not recorded, only the runner\'s `context`.',
  );
}

/** One test's documents, by the test, for the `context` fixture to hand its context to. */
const byTest = new WeakMap<TestInfo, TestDocuments>();

/**
 * Playwright's client instrumentation: what its own trace recorder hears every
 * context created and closed through. The public `browser.on('context')` is
 * not enough: `newContext` resolves without waiting for it, so the tape script
 * races the context's first page, and nothing is heard before a context
 * closes. A client without it says so, and only the runner's `context` is
 * adopted.
 */
interface Instrumented {
  readonly _instrumentation?: {
    readonly addListener: (listener: ContextListener) => void;
    readonly removeListener: (listener: ContextListener) => void;
  };
}

interface ContextListener {
  readonly runAfterCreateBrowserContext: (context: BrowserContext) => Promise<void>;
  readonly runBeforeCloseBrowserContext: (context: BrowserContext) => Promise<void>;
}

/**
 * `varianceDocuments`, automatic because a spec that opens its own context may
 * ask for no fixture: it hears every context made after it, and drains the
 * ones still open before `varianceCompleted` writes the story. The `context`
 * wrap adopts the runner's context, reused or not, and drains it after every
 * `afterEach` while it is still open — the last moment its crossings are
 * readable and the first they are all there.
 */
export const varianceDocumentFixtures: Fixtures<
  VarianceDocumentFixtures,
  RecorderFixture,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  varianceDocuments: [
    async ({ playwright, varianceRecorder }, use, testInfo) => {
      if (varianceRecorder === undefined) {
        await use();
        return;
      }
      const documents = testDocuments(varianceRecorder, testInfo);
      const listener: ContextListener = {
        runAfterCreateBrowserContext: (context) => documents.adopt(context),
        runBeforeCloseBrowserContext: (context) => documents.settle(context),
      };
      const instrumentation = (playwright as unknown as Instrumented)._instrumentation;
      if (instrumentation === undefined) unheard();
      instrumentation?.addListener(listener);
      byTest.set(testInfo, documents);
      try {
        await use();
      } finally {
        instrumentation?.removeListener(listener);
        byTest.delete(testInfo);
        await documents.close();
      }
    },
    { auto: true },
  ],

  // Asking for `varianceDocuments` sets it up first and tears it down after.
  context: async ({ context, varianceDocuments }, use, testInfo) => {
    void varianceDocuments;
    const documents = byTest.get(testInfo);
    if (documents === undefined) {
      await use(context);
      return;
    }
    await documents.adopt(context);
    await use(context);
    await documents.settle(context);
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

/** One test's documents. */
interface TestDocuments {
  /** Tape and watch `context`'s documents for this test, once, before they load. */
  readonly adopt: (context: BrowserContext) => Promise<void>;
  /** Drain `context`'s documents and stop watching it, once, while it is open. */
  readonly settle: (context: BrowserContext) => Promise<void>;
  /** Stop draining per statement, settle every context still open, and say whether any document was lost. */
  readonly close: () => Promise<void>;
}

/** A spec statement: the test line it is on, a hook's where `hook` says so. */
interface Statement {
  readonly line: number;
  readonly hook: boolean;
}

/** A context this test adopted. */
interface Adopted {
  readonly watch: Watch;
  settled: boolean;
}

/**
 * The contexts whose documents are taped. A context the runner reuses outlives
 * the test that taped it, and an init script added twice runs twice.
 */
const taped = new WeakSet<BrowserContext>();

/**
 * The documents of one test, drained before each statement the cadence plugin
 * ([`cadence-babel.cts`](./cadence-babel.cts)) marks with `__VA__.c`, so each
 * region is charged to the test line whose statement first reached it; what a
 * hook's statement reached, or a spec compiled without the plugin, is ambient.
 * Once a drain misses {@link STATEMENT_WAIT_MS} every later region is ambient,
 * since which statement reached it is no longer known. A drain that fails is
 * passed over: the document watch and the teardown drain decide.
 */
function testDocuments(recorder: NonNullable<RecorderFixture['varianceRecorder']>, testInfo: TestInfo): TestDocuments {
  type Cut = (line: number, file: string, hook: boolean) => unknown;
  const realm = globalThis as { __VA__?: { c?: Cut } };
  const outerRealm = realm.__VA__;
  const outer = outerRealm?.c;
  const owner = recorder.owner(testInfo);
  const subject = testOf(testInfo);
  const adopted = new Map<BrowserContext, Promise<Adopted>>();
  let last: Statement | undefined;
  // The statement whose line the story opened last: each context's teardown
  // drain lays what it reads under the same line, not a second.
  let opened: Statement | undefined;
  let late = false;
  let lost = false;
  let closed = false;
  let draining: Promise<void> = Promise.resolve();

  const lineOf = (statement: Statement | undefined) => (late ? undefined : statement?.line);
  const open = (statement: Statement | undefined): void => {
    if (statement === undefined || late || opened === statement || adopted.size === 0) return;
    opened = statement;
    recorder.cut?.(owner, subject, statement.line, statement.hook);
  };
  const framesOf = (context: BrowserContext): Frame[] => context.pages().flatMap((page) => page.frames());
  /** Drain `frames` under `statement`; resolves to whether every one was read. */
  const drain = async (frames: readonly Frame[], statement: Statement | undefined): Promise<boolean> => {
    let read = true;
    for (const frame of frames) {
      try {
        await recorder.note(frame, owner, subject, lineOf(statement), statement?.hook);
      } catch {
        // A frame detached between listing and draining, or a document torn
        // down mid-evaluation: its window is gone, which is the same fact as
        // a reload and is recorded the same way.
        read = false;
      }
    }
    return read;
  };
  const unsettled = async (): Promise<readonly BrowserContext[]> => {
    const contexts: BrowserContext[] = [];
    for (const [context, adoption] of adopted) if (!(await adoption).settled) contexts.push(context);
    return contexts;
  };
  const c: Cut = (line, file, hook) => {
    const theirs = outer?.(line, file, hook);
    // Once a drain was late no statement records its line, so none waits on
    // the held drain again: the teardown drain reads what they reached.
    if (file !== testInfo.file || late) return theirs;
    const reached = last;
    last = { line, hook };
    draining = draining.then(async () => {
      open(reached);
      for (const context of await unsettled()) await drain(framesOf(context), reached);
    });
    const waited = settlesInTime(draining).then((inTime) => {
      if (!inTime) late = true;
    });
    return theirs === undefined || theirs === null ? waited : Promise.all([theirs, waited]);
  };
  if (outerRealm === undefined) realm.__VA__ = { c };
  else outerRealm.c = c;
  const unheard = hearPrints(recorder, (text) => {
    // Said under the statement printing it, after what the pages did before it.
    const at = last;
    draining = draining.then(() => {
      open(at);
      recorder.say?.(owner, subject, text);
    });
  });

  const settle = async (context: BrowserContext): Promise<void> => {
    const adoption = adopted.get(context);
    if (adoption === undefined) return;
    const entry = await adoption;
    if (entry.settled) return;
    entry.settled = true;
    entry.watch.stop();
    // A page that held the statements' drain holds this one too, and the test's
    // timeout is all that would end it: the case is not believed whole instead.
    const inTime = await settlesInTime(draining);
    if (!inTime) late = true;
    if (entry.watch.lost() || !inTime) lost = true;
    if (inTime) {
      open(last);
      if (!(await drain(framesOf(context), last))) lost = true;
    }
  };

  return {
    adopt: async (context) => {
      if (closed) return;
      const known = adopted.get(context);
      if (known !== undefined) {
        await known;
        return;
      }
      const adoption = (async (): Promise<Adopted> => {
        // Before any page loads, so the collector a page evaluates finds the tape.
        if (recorder.storyPage !== undefined && !taped.has(context)) {
          taped.add(context);
          await context.addInitScript(recorder.storyPage);
        }
        return { watch: watchDocuments(context), settled: false };
      })();
      adopted.set(context, adoption);
      await adoption;
    },
    settle,
    close: async () => {
      unheard();
      if (outerRealm === undefined) delete realm.__VA__;
      else if (outer === undefined) delete outerRealm.c;
      else outerRealm.c = outer;
      for (const context of adopted.keys()) await settle(context);
      closed = true;
      if (lost) recorder.mark(owner, false);
    },
  };
}

const PRINTS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/**
 * Hear what the spec prints in the runner's process, as a Node case's tap hears
 * its console, while the run asks for stories; still printed. Returns what puts
 * the console back.
 */
function hearPrints(recorder: NonNullable<RecorderFixture['varianceRecorder']>, heard: (text: string) => void): () => void {
  if (recorder.say === undefined) return () => {};
  const printer = console;
  const originals = PRINTS.map((method) => [method, printer[method]] as const);
  for (const [method, original] of originals) {
    printer[method] = function (this: unknown, ...values: unknown[]): void {
      try {
        heard(`console.${method} ${format(...values)}`);
      } catch {
        // A value whose inspection throws is still printed below.
      }
      original.apply(this, values);
    };
  }
  return () => {
    for (const [method, original] of originals) printer[method] = original;
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
    // FIXME: what the replaced document ran since the drain before is missing
    // from its story. Chromium tells nothing of a document whose navigation has
    // started: an evaluation sent on this event finds its context destroyed, a
    // raw CDP one reads the next document, and a binding or beacon sent from its
    // `pagehide` reaches neither Playwright nor CDP. WebKit answers all three.
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
