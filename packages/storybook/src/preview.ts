import {
  DEFAULT_PREVIEW_GLOBALS,
  FINISHED_RECORD_KEY,
  STORYBOOK_ERROR_OVERLAY,
  STORYBOOK_EVENTS,
  STORY_ROOT_SELECTORS,
  type ErrorOverlay,
  type FinishRequest,
  type PreviewGlobals,
  type Readiness,
  type ShowEvents,
  type ShowRequest,
  type ShowStatus,
} from './preview-protocol.js';
import { awaitFinish } from './finish-wait.js';
import { applyGlobals } from './preview-globals.js';
import { previewUrl } from './preview-url.js';
import { showStory } from './show-story.js';
import { beginFinishWatch } from './story-finished.js';

/**
 * Driving a Storybook preview: one navigation, N stories.
 *
 * The preview is an iframe with a URL per story, so the obvious implementation
 * is one `goto` per subject. That is exactly the per-subject setup cost ADR-0009
 * refuses to pay — a reload re-parses the design system's stylesheet, re-boots
 * the preview runtime, and re-runs every decorator, on every story, forever. It
 * also destroys the property that makes a session worth having: cross-pollution
 * becomes impossible, and so does *measuring* it.
 *
 * So this navigates once, and thereafter switches stories over Storybook's own
 * channel — the same `setCurrentStory` the manager sidebar sends. Stories then
 * share a document, which is a corner deliberately cut and paid for elsewhere:
 * the session's probe detects what one story left behind for the next
 * (ADR-0009), rather than preventing it.
 *
 * What stays in this file is that navigation policy and the outcome it hands
 * back. The parts that answer to different constraints have their own modules
 * and are re-exported below, so this is still the one import: the page function
 * in `show-story.ts`, which may close over nothing; the end-of-render watch in
 * `story-finished.ts`, whose waiting half is here because a page's clock belongs
 * to whoever is testing it; the request and result declarations both halves
 * speak in `preview-protocol.ts`; the URL rules in `preview-url.ts`.
 *
 * **A story that throws is a subject, not a crash.** Every failure mode the
 * preview can report — a throwing render, a throwing play function, an errored
 * story, a story the preview does not have — comes back as an outcome carrying
 * the error. The remaining stories are still observed (ADR-0020).
 */

/**
 * Everything the modules above export, exported from here as well.
 *
 * Not tidiness: `./preview.js` is a path other packages already import, and a
 * file that grew too long is this package's problem rather than theirs. The
 * split moves code and moves nothing else.
 */
export { PREVIEW_PATH, previewUrl } from './preview-url.js';
export { showStory } from './show-story.js';
export { beginFinishWatch, markFinishAbsent, readFinishRecord } from './story-finished.js';
export { applyGlobals } from './preview-globals.js';
export {
  DEFAULT_PREVIEW_GLOBALS,
  FINISHED_RECORD_KEY,
  STORYBOOK_ERROR_OVERLAY,
  STORYBOOK_EVENTS,
  STORY_ROOT_SELECTORS,
} from './preview-protocol.js';
export type {
  ErrorOverlay,
  FinishRecord,
  FinishRequest,
  GlobalsRequest,
  PreviewGlobals,
  Readiness,
  ShowEvents,
  ShowRequest,
  ShowResult,
  ShowStatus,
} from './preview-protocol.js';

/**
 * The slice of a browser page this adapter drives.
 *
 * Three methods, so a caller can implement this with a dozen lines and the
 * navigation policy — the thing this file exists to get right — stays testable
 * without a browser or a Storybook.
 *
 * `evaluate` is generic because more than one function is shipped into the page:
 * the story is shown by one, and the watch that says when Storybook has finished
 * with it is opened and read by three more. An implementation must serialize the
 * function it is given rather than call it, which is what the browser does and
 * what a fake has to imitate for a page function that closed over a module
 * constant to fail here rather than in a headless browser nobody is watching.
 */
export interface StoryPage {
  /** The page's current URL, which is how "already navigated" is decided. */
  url(): string;
  goto(url: string): Promise<void>;
  evaluate<A, R>(fn: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
}

/**
 * A browser page, named rather than imported.
 *
 * `@variance-authority/playwright`'s `Harness` satisfies this, and so does a bare
 * Playwright `Page` wrapped in an object — but neither is a *dependency*, because
 * naming the three methods costs six lines and importing the type costs every
 * consumer of this package a browser they may never open. Storybook support and
 * browser support are separate concerns that meet at a URL and a function call,
 * and this is where that seam is.
 */
export interface BrowserHarness {
  readonly page: {
    url(): string;
    goto(url: string, options?: { readonly waitUntil?: 'load' }): Promise<unknown>;
    evaluate<A, R>(fn: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
  };
}

/**
 * Drive the page a harness already owns.
 *
 * The harness holds the browser, the viewport, the injected collector, and the
 * one navigation this adapter is allowed. Wrapping rather than passing the page
 * straight through keeps the interface above small enough to fake, and pins
 * `waitUntil` at the same `load` the harness itself uses.
 */
export function harnessPage(harness: BrowserHarness): StoryPage {
  const { page } = harness;
  return {
    url: () => page.url(),
    goto: async (url: string): Promise<void> => {
      await page.goto(url, { waitUntil: 'load' });
    },
    evaluate: (fn, argument) => page.evaluate(fn, argument),
  };
}

export interface CollectOptions {
  /** Storybook's root URL — `http://localhost:6006`, or a `file://` build. */
  readonly baseUrl: string;
  /** Budget for one story to become ready. Defaults to 15s. */
  readonly timeoutMs?: number;
  /** Markup sampling interval on the fallback path. Defaults to 50ms. */
  readonly pollMs?: number;
  readonly events?: ShowEvents;
  readonly roots?: readonly string[];
  readonly errorOverlay?: ErrorOverlay;
  /**
   * Selector for a readiness marker the subject attaches when it has settled —
   * `[data-testid="story-ready"]`, or whatever the project already uses.
   *
   * Omitted, nothing changes: readiness is decided by Storybook's signal and the
   * quiescence fallback, exactly as before. Supplied, it becomes the only thing
   * that can produce a `rendered` outcome, and a story that never attaches it
   * times out rather than being captured on weaker evidence.
   *
   * Worth the configuration for any component that fetches, animates, or defers
   * work to an effect: those are the stories that make a suite flaky, and this is
   * the one signal that can end the flake instead of re-running it.
   */
  readonly readySelector?: string;
  /**
   * Globals set on the preview once per document, before the first story.
   *
   * Defaults to `DEFAULT_PREVIEW_GLOBALS`, which turns off
   * `@storybook/addon-a11y`'s automatic scan for this pass and nothing else —
   * see {@link PreviewGlobals} for what that does and does not touch. Pass `{}`
   * to leave the preview exactly as the project configured it.
   */
  readonly globals?: PreviewGlobals;
}

export interface StoryOutcome {
  readonly storyId: string;
  /** Preview URL for this story; the URL actually navigated to, when it was. */
  readonly url: string;
  /**
   * Whether this story cost a navigation.
   *
   * `true` exactly once in a healthy run. A second `true` is the signal that the
   * saving ADR-0009 is built on is not being realised, so it is reported rather
   * than counted internally (ADR-0020).
   */
  readonly navigated: boolean;
  readonly status: ShowStatus;
  readonly readiness: Readiness;
  readonly channel: boolean;
  readonly root?: string;
  readonly error?: StoryError;
  readonly warnings: readonly string[];
}

export interface StoryError {
  /**
   * Which layer failed.
   *
   * `story` is the preview's side of the bridge — a render that threw, a story
   * the preview does not have, one that never settled. `page` is the browser or
   * the page itself refusing to be driven. `observer` is the caller's own
   * capture throwing on a story that rendered fine. Collapsing them would send
   * an agent to debug a component because Chromium crashed.
   */
  readonly from: 'story' | 'page' | 'observer';
  readonly message: string;
  readonly stack?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_MS = 50;

/**
 * Show one story on an already-running page and report what the preview did.
 *
 * Never throws for anything the story did. A throwing render, a missing story, a
 * preview that never signals, a browser that has gone away — each comes back as
 * a {@link StoryOutcome} with a status and, where there is one, an error. The
 * caller loops; a run of 300 stories is not ended by the fourth.
 *
 * Navigation is decided from the page's own URL rather than from a flag, so the
 * one-navigation rule holds across callers, retries, and a harness that was
 * already pointed at the preview.
 */
export async function collectStory(
  page: StoryPage,
  storyId: string,
  options: CollectOptions,
): Promise<StoryOutcome> {
  const url = previewUrl(options.baseUrl, storyId);
  const request: ShowRequest = {
    storyId,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pollMs: options.pollMs ?? DEFAULT_POLL_MS,
    events: options.events ?? STORYBOOK_EVENTS,
    roots: options.roots ?? STORY_ROOT_SELECTORS,
    errorOverlay: options.errorOverlay ?? STORYBOOK_ERROR_OVERLAY,
    // Spread rather than assigned: under `exactOptionalPropertyTypes` an
    // explicit `undefined` is not the same as absent, and absent is what turns
    // the feature off. There is no default to fall back to on purpose.
    ...(options.readySelector !== undefined ? { readySelector: options.readySelector } : {}),
  };

  const watch: FinishRequest = {
    key: FINISHED_RECORD_KEY,
    event: request.events.storyFinished,
    storyId,
  };

  const extra: string[] = [];
  let navigated = false;

  try {
    if (!onPreview(page.url(), url)) {
      await page.goto(url);
      navigated = true;
    }

    // Once per document, and therefore here rather than in a session hook: a
    // preview that reloads — which is what this whole file is arranged to
    // prevent, and still happens on the channel-less path — comes back with the
    // project's own globals, and an addon this pass turned off would be back on
    // for every story after it.
    if (navigated) await setGlobals(page, options, request.events.updateGlobals);

    // Before the story is shown, not after: a story that finishes inside the
    // round trip back to Node would otherwise finish with nobody listening, and
    // every fast subject would pay the full grace below to learn nothing.
    await page.evaluate(beginFinishWatch, watch);

    let result = await page.evaluate(showStory, request);

    if (!result.channel && !navigated) {
      // No channel means no way to switch stories in place, so this story costs
      // a reload — the per-subject setup cost ADR-0009 refuses to pay. Paid,
      // because the alternative is observing the previous story under this
      // story's id, and *reported*, because a run silently doing this is a run
      // whose economics are not what its owner thinks.
      await page.goto(url);
      navigated = true;
      extra.push(
        'no Storybook channel on the preview, so this story was shown by reloading the iframe: ' +
          'one navigation per subject, which is the cost a session exists to avoid (ADR-0009)',
      );
      await setGlobals(page, options, request.events.updateGlobals);
      await page.evaluate(beginFinishWatch, watch);
      result = await page.evaluate(showStory, request);
    }

    if (result.status === 'rendered' && result.channel) {
      const note = await awaitFinish(page, request);
      if (note !== undefined) extra.push(note);
    }

    return {
      storyId,
      url,
      navigated,
      status: result.status,
      readiness: result.readiness,
      channel: result.channel,
      ...(result.root !== null ? { root: result.root } : {}),
      ...(result.message !== undefined
        ? {
            error: {
              from: result.status === 'unreachable' ? ('page' as const) : ('story' as const),
              message: result.message,
              ...(result.stack !== undefined ? { stack: result.stack } : {}),
            },
          }
        : {}),
      warnings: [...extra, ...result.warnings],
    };
  } catch (error) {
    // A rejected `goto` or `evaluate` is the browser, not the component. Saying
    // so keeps an agent from reading a closed page as a visual regression.
    return {
      storyId,
      url,
      navigated,
      status: 'unreachable',
      readiness: 'none',
      channel: false,
      error: {
        from: 'page',
        message: `the preview page could not be driven: ${messageOf(error)}`,
        ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
      },
      warnings: extra,
    };
  }
}

export interface CollectManyOptions extends CollectOptions {
  /**
   * Called after a story became ready, before the next one is shown.
   *
   * This is where a capture goes. Sequential by contract, like the harness it
   * drives: two concurrent observers would render two stories into one document
   * and let each decide the other's verdict.
   *
   * Called only for `rendered` stories — there is nothing to capture from one
   * that threw, and capturing the *previous* story's markup under this story's
   * id is how a suite acquires a baseline that never corresponded to anything.
   */
  readonly observe?: (outcome: StoryOutcome) => Promise<void> | void;
}

/**
 * Show a list of stories on one page, in order, and report every one.
 *
 * The order is the caller's, and it matters: a session's pollution findings name
 * the *earlier* subject as the culprit (ADR-0009), so a list whose order varies
 * between machines produces findings that do too. `toSubjects` supplies a
 * deterministic one.
 */
export async function collectStories(
  page: StoryPage,
  storyIds: readonly string[],
  options: CollectManyOptions,
): Promise<readonly StoryOutcome[]> {
  const outcomes: StoryOutcome[] = [];

  for (const storyId of storyIds) {
    const outcome = await collectStory(page, storyId, options);

    if (outcome.status !== 'rendered' || options.observe === undefined) {
      outcomes.push(outcome);
      continue;
    }

    try {
      await options.observe(outcome);
      outcomes.push(outcome);
    } catch (error) {
      // The story rendered; the caller's capture is what failed. Recorded as
      // such and the run continues, because one unserializable capture must not
      // cost the other 299 observations.
      outcomes.push({
        ...outcome,
        status: 'errored',
        error: {
          from: 'observer',
          message: `the story rendered, but observing it failed: ${messageOf(error)}`,
          ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
        },
      });
    }
  }

  return outcomes;
}

/**
 * Tell the preview's addons what this pass is for, before it asks for anything.
 *
 * Best-effort by construction: a preview with no channel cannot be told, and
 * that is already reported as the reload cost it is. Nothing is asserted about
 * the result because an addon that is not installed is the ordinary case — a
 * global nobody reads is a global nobody reads.
 */
async function setGlobals(page: StoryPage, options: CollectOptions, event: string): Promise<void> {
  const globals = options.globals ?? DEFAULT_PREVIEW_GLOBALS;
  if (Object.keys(globals).length === 0) return;
  await page.evaluate(applyGlobals, { event, globals });
}

/**
 * Whether the page is already on this Storybook's preview.
 *
 * Origin and path only: the query is where the story id lives, and comparing it
 * would make every story a fresh navigation — which is the entire cost this
 * module is built to avoid.
 */
function onPreview(current: string, target: string): boolean {
  try {
    const here = new URL(current);
    const there = new URL(target);
    return here.origin === there.origin && here.pathname === there.pathname;
  } catch {
    // `about:blank` and the empty string land here. Both mean "navigate".
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
