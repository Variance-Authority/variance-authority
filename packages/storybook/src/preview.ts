import type { Harness } from '@variance-authority/harness-playwright';

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
 * **Readiness is reported, never assumed.** Storybook emits `storyRendered`
 * when it is done, and that signal is the only one that knows about decorators,
 * loaders, and async render phases. When it is absent — an older preview, a
 * build with the channel stripped, a page that is not a Storybook at all — this
 * falls back to a markup-quiescence heuristic, and the fallback is *named in the
 * result*. The two are not equivalent and callers must not be able to confuse
 * them: quiescent markup cannot see a story still waiting on a fetch, a font
 * swap, or an image, so a capture taken on that evidence is a capture of an
 * unfinished story. Saying which evidence was used is the difference between a
 * weaker claim and a false one.
 *
 * **Storybook's chrome is not the subject.** The story mounts into
 * `#storybook-root` (`#root` before Storybook 7), and that element — not the
 * preview `<body>` — is the subject root. Naming it correctly is this package's
 * whole contribution to ADR-0003: the preview reset, the `sb-*` layout classes,
 * and the error overlay all sit *outside* the subtree, so applicability pruning
 * drops every rule of theirs for the ordinary reason that it matches nothing in
 * the subject. Nothing here needs a Storybook-specific denylist, and that is the
 * point — a denylist would be a second ruleset, versioned by nobody.
 *
 * **A story that throws is a subject, not a crash.** Every failure mode the
 * preview can report — a throwing render, a throwing play function, an errored
 * story, a story the preview does not have — comes back as an outcome carrying
 * the error. The remaining stories are still observed (spec 0006, acceptance 4).
 */

/** Path a built Storybook serves its preview from, relative to the base URL. */
export const PREVIEW_PATH = 'iframe.html';

/**
 * Where a story mounts, newest spelling first.
 *
 * `#storybook-root` since Storybook 7; `#root` before it. Both are checked
 * because an adapter that guessed wrong would observe an empty subtree and
 * report a subject with no content as unchanged forever.
 */
export const STORY_ROOT_SELECTORS: readonly string[] = ['#storybook-root', '#root'];

/**
 * Channel event names.
 *
 * Injected through the request rather than closed over, because the function
 * that uses them is serialized and shipped into the page (see {@link showStory})
 * — a module-scope constant would arrive as a `ReferenceError`. Overridable so a
 * project on a Storybook that renamed an event can say so instead of forking.
 */
export interface ShowEvents {
  readonly setCurrentStory: string;
  readonly storyRendered: string;
  readonly storyThrewException: string;
  readonly storyErrored: string;
  readonly storyMissing: string;
  readonly playFunctionThrewException: string;
}

export const STORYBOOK_EVENTS: ShowEvents = {
  setCurrentStory: 'setCurrentStory',
  storyRendered: 'storyRendered',
  storyThrewException: 'storyThrewException',
  storyErrored: 'storyErrored',
  storyMissing: 'storyMissing',
  playFunctionThrewException: 'playFunctionThrewException',
};

/**
 * How Storybook's preview renders a fatal error, as of Storybook 7/8.
 *
 * Only consulted on the channel-less path, where there is no event to carry the
 * error. Best-effort by nature: these are presentation details of a package this
 * one does not depend on, so they are configuration rather than a constant.
 */
export interface ErrorOverlay {
  readonly bodyClass: string;
  readonly message: string;
  readonly stack: string;
}

export const STORYBOOK_ERROR_OVERLAY: ErrorOverlay = {
  bodyClass: 'sb-show-errordisplay',
  message: '#error-message',
  stack: '#error-stack',
};

/** Everything {@link showStory} needs, since it can close over nothing. */
export interface ShowRequest {
  readonly storyId: string;
  /** Budget for the story to signal that it rendered. */
  readonly timeoutMs: number;
  /** Interval between markup samples on the fallback path. */
  readonly pollMs: number;
  readonly events: ShowEvents;
  readonly roots: readonly string[];
  readonly errorOverlay: ErrorOverlay;
}

/**
 * What the preview was observed to do.
 *
 * `rendered` is the only status a capture may be taken on. `timeout` and
 * `no-root` are deliberately not folded into it: a story that never finished and
 * a story that rendered nothing are both *unobserved*, and an unobserved subject
 * reported as observed is a false `unchanged` waiting to happen.
 */
export type ShowStatus = 'rendered' | 'errored' | 'missing' | 'timeout' | 'no-root' | 'unreachable';

/**
 * Which evidence decided that the story was ready.
 *
 * - `storyRendered` — Storybook said so. The only signal that knows about
 *   decorators, loaders, and async render phases.
 * - `already-rendered` — the story the URL selected was already in the document
 *   when this ran, so its `storyRendered` had already fired; readiness came from
 *   markup that stopped changing.
 * - `markup-quiescent` — the fallback: the root mounted and its markup was
 *   identical across two samples. Strictly weaker, and blind to anything that
 *   arrives later.
 * - `none` — nothing was ready; the status says what happened instead.
 */
export type Readiness = 'storyRendered' | 'already-rendered' | 'markup-quiescent' | 'none';

export interface ShowResult {
  readonly status: ShowStatus;
  readonly readiness: Readiness;
  /** Whether a Storybook channel was found. `false` means every switch reloads. */
  readonly channel: boolean;
  /** Selector the story mounted into, or `null` when nothing did. */
  readonly root: string | null;
  readonly message?: string;
  readonly stack?: string;
  readonly warnings: readonly string[];
}

interface StoryChannel {
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload: unknown): void;
}

interface StorybookScope {
  readonly __STORYBOOK_PREVIEW__?: {
    readonly channel?: StoryChannel;
    readonly currentSelection?: { readonly storyId?: string };
  };
  readonly __STORYBOOK_ADDONS_CHANNEL__?: StoryChannel;
}

/**
 * Show one story and report what happened. **Runs in page scope.**
 *
 * Serialized to source text and evaluated in the browser, exactly as the
 * harness does with its agent bundle. Two consequences, both load-bearing:
 * it may close over nothing — every constant it needs arrives in `request` —
 * and it may not import. A closed-over module constant compiles, type-checks,
 * and fails at run time with a `ReferenceError` inside a browser nobody is
 * watching, which is why the test drives it through the same serialization.
 */
export const showStory = (request: ShowRequest): Promise<ShowResult> => {
  const scope = window as unknown as StorybookScope;
  const channel = scope.__STORYBOOK_PREVIEW__?.channel ?? scope.__STORYBOOK_ADDONS_CHANNEL__ ?? null;
  const warnings: string[] = [];

  const rootSelector = (): string | null => {
    for (const selector of request.roots) {
      const element = document.querySelector(selector);
      // Emptiness is part of the test. `#storybook-root` exists from the moment
      // the preview boots, so its mere presence says nothing about a story.
      if (element !== null && element.childElementCount > 0) return selector;
    }
    return null;
  };

  const markupOf = (selector: string): string => document.querySelector(selector)?.innerHTML ?? '';

  const overlay = (): { message: string; stack: string } | null => {
    if (!document.body.classList.contains(request.errorOverlay.bodyClass)) return null;
    return {
      message:
        document.querySelector(request.errorOverlay.message)?.textContent ??
        'the preview displayed an error with no message',
      stack: document.querySelector(request.errorOverlay.stack)?.textContent ?? '',
    };
  };

  const result = (
    status: ShowStatus,
    readiness: Readiness,
    extra: { message?: string; stack?: string; notes?: readonly string[] } = {},
  ): ShowResult => ({
    status,
    readiness,
    channel: channel !== null,
    root: rootSelector(),
    ...(extra.message !== undefined ? { message: extra.message } : {}),
    ...(extra.stack !== undefined && extra.stack !== '' ? { stack: extra.stack } : {}),
    warnings: [...warnings, ...(extra.notes ?? [])],
  });

  /**
   * Wait for the story root to stop changing.
   *
   * Two identical samples rather than one non-empty one: a framework that mounts
   * a shell and then fills it would otherwise be captured mid-flight. Polling
   * rather than `requestAnimationFrame` because a backgrounded page throttles
   * frames, and a readiness check that depends on being visible is a readiness
   * check that fails in CI.
   */
  const settleByMarkup = (
    readiness: Readiness,
    budgetMs: number,
    notes: readonly string[],
  ): Promise<ShowResult> =>
    new Promise<ShowResult>((resolve) => {
      const deadline = Date.now() + budgetMs;
      let previous: string | null = null;

      const tick = (): void => {
        const failed = overlay();
        if (failed !== null) {
          resolve(result('errored', 'none', { message: failed.message, stack: failed.stack, notes }));
          return;
        }

        const root = rootSelector();
        if (root !== null && document.readyState === 'complete') {
          const markup = markupOf(root);
          if (previous === markup) {
            resolve(result('rendered', readiness, { notes }));
            return;
          }
          previous = markup;
        }

        if (Date.now() >= deadline) {
          resolve(
            root === null
              ? result('no-root', 'none', {
                  message: `nothing mounted into ${request.roots.join(' or ')} within ${budgetMs}ms`,
                  notes,
                })
              : result('timeout', 'none', {
                  message: `the story root was still changing after ${budgetMs}ms`,
                  notes,
                }),
          );
          return;
        }

        setTimeout(tick, request.pollMs);
      };

      tick();
    });

  if (channel === null) {
    return settleByMarkup('markup-quiescent', request.timeoutMs, [
      'no Storybook channel was found on the preview window, so readiness was decided by markup ' +
        'quiescence: the root mounted and stopped changing. That cannot see a story still waiting ' +
        'on a fetch, a font, or an image.',
    ]);
  }

  return new Promise<ShowResult>((resolve) => {
    const listeners: { event: string; handler: (payload: unknown) => void }[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: ShowResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      // Listeners outlive the story: the page is not reloaded between subjects,
      // so a handler left attached would answer for the *next* story as well.
      for (const entry of listeners) channel.off(entry.event, entry.handler);
      resolve(value);
    };

    const listen = (event: string, handler: (payload: unknown) => void): void => {
      listeners.push({ event, handler });
      channel.on(event, handler);
    };

    const idOf = (payload: unknown): string | null => {
      if (typeof payload === 'string') return payload;
      if (typeof payload === 'object' && payload !== null) {
        const storyId = (payload as { storyId?: unknown }).storyId;
        if (typeof storyId === 'string') return storyId;
      }
      return null;
    };

    /**
     * Whether an event is about the story being waited on.
     *
     * An event whose payload carries no id is accepted, and the acceptance is
     * recorded. Refusing it would hang until the timeout on any Storybook that
     * changed the payload shape, which turns a cosmetic version difference into
     * a suite that never finishes.
     */
    const mine = (payload: unknown): boolean => {
      const id = idOf(payload);
      if (id !== null) return id === request.storyId;
      warnings.push(
        `a Storybook event carried no story id and was accepted as \`${request.storyId}\`'s`,
      );
      return true;
    };

    const describeError = (payload: unknown): { message: string; stack: string } => {
      if (typeof payload === 'string') return { message: payload, stack: '' };
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as {
          title?: unknown;
          description?: unknown;
          message?: unknown;
          stack?: unknown;
        };
        const parts = [record.title, record.description, record.message].filter(
          (part): part is string => typeof part === 'string' && part !== '',
        );
        if (parts.length > 0) {
          return {
            message: parts.join(' — '),
            stack: typeof record.stack === 'string' ? record.stack : '',
          };
        }
      }
      const serialized = JSON.stringify(payload);
      return { message: typeof serialized === 'string' ? serialized : String(payload), stack: '' };
    };

    listen(request.events.storyRendered, (payload) => {
      if (mine(payload)) finish(result('rendered', 'storyRendered'));
    });

    // No id filter on the exception events: Storybook sends a serialized error,
    // not a story id, and only one story is rendering at a time.
    listen(request.events.storyThrewException, (payload) => {
      finish(result('errored', 'none', describeError(payload)));
    });
    listen(request.events.playFunctionThrewException, (payload) => {
      const error = describeError(payload);
      finish(
        result('errored', 'none', {
          message: `the story's play function threw: ${error.message}`,
          stack: error.stack,
        }),
      );
    });
    listen(request.events.storyErrored, (payload) => {
      finish(result('errored', 'none', describeError(payload)));
    });
    listen(request.events.storyMissing, (payload) => {
      if (!mine(payload)) return;
      finish(
        result('missing', 'none', {
          message:
            `the preview has no story \`${request.storyId}\`; the index and the built preview ` +
            `disagree, which usually means one of them is stale`,
        }),
      );
    });

    if (scope.__STORYBOOK_PREVIEW__?.currentSelection?.storyId === request.storyId) {
      // The first story of a session arrives selected by the URL, so its
      // `storyRendered` may have fired before this function was injected.
      // Waiting for it alone would burn the whole timeout and then report a
      // story that is sitting fully rendered on the screen as a timeout.
      settleByMarkup('already-rendered', request.timeoutMs, []).then(finish, (error: unknown) => {
        finish(result('unreachable', 'none', { message: String(error) }));
      });
      return;
    }

    try {
      channel.emit(request.events.setCurrentStory, { storyId: request.storyId, viewMode: 'story' });
    } catch (error) {
      // Storybook's channel dispatches synchronously, so a story that throws
      // during render can throw straight back out of `emit`. Left unhandled that
      // rejects the evaluate and takes the rest of the run with it — precisely
      // the crashed run spec 0006 forbids.
      const described = describeError(error);
      finish(
        result('errored', 'none', {
          message: `switching to the story threw: ${described.message}`,
          stack: described.stack,
        }),
      );
      return;
    }

    timer = setTimeout(() => {
      // The channel said nothing in time. Rather than reporting a timeout for a
      // story that may be sitting rendered on the screen, check the weaker
      // evidence — and say that is what happened. Four polls is the least that
      // can produce two identical samples.
      settleByMarkup('markup-quiescent', request.pollMs * 4, [
        `no \`${request.events.storyRendered}\` within ${request.timeoutMs}ms; readiness fell back ` +
          `to markup quiescence, which is weaker evidence than Storybook's own signal`,
      ]).then(finish, (error: unknown) => {
        finish(result('unreachable', 'none', { message: String(error) }));
      });
    }, request.timeoutMs);
  });
};

/**
 * The slice of a browser page this adapter drives.
 *
 * Concrete rather than generic on purpose: exactly one function is ever shipped
 * into the page, so the interface can name it, and a caller can implement this
 * with a dozen lines. That is what makes the navigation policy — the thing this
 * file exists to get right — testable without a browser or a Storybook.
 */
export interface StoryPage {
  /** The page's current URL, which is how "already navigated" is decided. */
  url(): string;
  goto(url: string): Promise<void>;
  evaluate(fn: (request: ShowRequest) => Promise<ShowResult>, request: ShowRequest): Promise<ShowResult>;
}

/**
 * Drive the page a {@link Harness} already owns.
 *
 * The harness holds the browser, the viewport, the injected collector, and the
 * one navigation this adapter is allowed. Wrapping rather than passing the
 * Playwright `Page` straight through keeps the interface above small enough to
 * fake, and pins `waitUntil` at the same `load` the harness itself uses.
 */
export function harnessPage(harness: Harness): StoryPage {
  const { page } = harness;
  return {
    url: () => page.url(),
    goto: async (url: string): Promise<void> => {
      await page.goto(url, { waitUntil: 'load' });
    },
    evaluate: (fn, request) => page.evaluate(fn, request),
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
   * than counted internally (spec 0006, acceptance 3).
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
 * Build the preview URL for one story.
 *
 * `viewMode=story` is explicit rather than left to default, because the
 * alternative — `docs` — renders a page of prose around the component and would
 * be captured as the subject.
 */
export function previewUrl(baseUrl: string, storyId: string): string {
  if (storyId === '') throw new Error('a story id is required to build a preview URL');

  const url = new URL(PREVIEW_PATH, previewBase(baseUrl));
  url.searchParams.set('id', storyId);
  url.searchParams.set('viewMode', 'story');
  return url.href;
}

function previewBase(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      `\`${baseUrl}\` is not a URL. The Storybook base is absolute — \`http://localhost:6006\` for ` +
        `a dev server, or a \`file://\` path to a built Storybook directory.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
    // `localhost:6006` parses: `localhost:` becomes the protocol and `6006` the
    // path, so the omitted scheme survives all the way to a resolution failure
    // three lines later with a message about `iframe.html`. Caught here, where
    // the actual mistake is.
    throw new Error(
      `\`${baseUrl}\` has protocol \`${url.protocol}\`. The Storybook base is an absolute ` +
        `\`http\`, \`https\`, or \`file\` URL — a host and port with no scheme parses as a ` +
        `protocol rather than as a host.`,
    );
  }

  if (url.search !== '' || url.hash !== '') {
    // `http://localhost:6006/?path=/story/button--primary` is a link copied out
    // of the manager, and its query would be silently dropped by the join below.
    // Refusing says which URL is wanted; dropping would produce a preview URL
    // that works and quietly ignores half of what was asked for.
    throw new Error(
      `\`${baseUrl}\` carries a query or fragment. The Storybook base is its root URL, not a link ` +
        `copied from the manager; story selection is this function's job.`,
    );
  }

  // A base naming the preview itself is the likelier typo than a directory
  // actually called `iframe.html`, and joining onto it yields `iframe.html/iframe.html`.
  if (url.pathname.endsWith(`/${PREVIEW_PATH}`)) {
    url.pathname = url.pathname.slice(0, -PREVIEW_PATH.length);
  } else if (!url.pathname.endsWith('/')) {
    // Without this the last path segment is treated as a file and replaced, so
    // `http://host/storybook` would resolve to `http://host/iframe.html`.
    url.pathname = `${url.pathname}/`;
  }

  return url;
}

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
  };

  const extra: string[] = [];
  let navigated = false;

  try {
    if (!onPreview(page.url(), url)) {
      await page.goto(url);
      navigated = true;
    }

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
      result = await page.evaluate(showStory, request);
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
