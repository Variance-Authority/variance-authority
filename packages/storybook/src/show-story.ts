import type { Readiness, ShowRequest, ShowResult, ShowStatus, StorybookScope } from './preview-protocol.js';

/**
 * The half of this adapter that runs inside the browser.
 *
 * Alone in a module because it obeys rules nothing else here does: it is
 * serialized to source text and evaluated in page scope, so it may close over
 * nothing and import nothing but types. A file that holds the page function and
 * only the page function makes that constraint checkable by looking: anything
 * added beside it that is not a type is a constant this function might come to
 * reference, and a constant it references is a `ReferenceError` inside a
 * headless browser nobody is watching. The request carries every constant it
 * needs; `preview-protocol.ts` holds the declarations that describe it.
 *
 * **Readiness is reported, never assumed.** Storybook emits `storyRendered`
 * when it is done, and that signal is the only one that knows about decorators,
 * loaders, and async render phases. A story already on screen when this runs
 * is read from Storybook's own `currentRender`, whose phase says whether that
 * render is over. Markup that stopped changing is never taken for either: it
 * cannot see a story still waiting on a fetch, a font swap, or an image. Where
 * Storybook gives no signal — no channel, or no `storyRendered` before the
 * bound — the story is refused, naming what did not arrive, and a project
 * whose preview cannot say so attaches a readiness marker instead.
 *
 * **The subject outranks the framework.** `storyRendered` means Storybook
 * believes the story function returned, not that the *application* settled — a
 * component that fetches on mount or animates in is still moving when it fires.
 * So a project may name a readiness marker its own code attaches, and a marker
 * the application attached is stronger evidence than any event the framework can
 * emit. The marker is a contract, and a contract that can be quietly substituted
 * is not one: a configured marker that never arrives is reported as a timeout
 * naming it. A project that asked to be asked,
 * answered with a guess, is worse off than one that never asked.
 *
 * Handing a story back is not the same as making the switch to the next one
 * safe; `story-finished.ts` holds that half, and says why it is not here.
 */

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

  /**
   * Stop reading the page the moment an answer has been handed back.
   *
   * The marker poll below runs on its own `setTimeout` chain, and can still be
   * mid-flight when the channel answers first. In a browser an
   * unstopped chain costs a few wasted `querySelector` calls; off a browser it is
   * a timer that outlives the DOM it reads, and the straggler's `ReferenceError`
   * is attributed to whichever subject happened to be running.
   *
   * `abandonPolls` is called by `finish`, so the polls stop where the answer did.
   * A chain that reaches this guard leaves its promise pending forever, which is
   * correct: its only caller is a `.then(finish)` that would no-op.
   */
  let handedBack = false;
  /**
   * The page's monotonic clock, for measuring how long something has taken.
   *
   * Deliberately not `Date.now()`. This runs inside the subject's own page, and the
   * wall clock there belongs to whoever is testing: pinning it is the ordinary fix
   * for a story built from `Date.now()`, and none of this project's business. Not
   * breaking when they do is. A deadline written as `Date.now() + budget` never
   * arrives on a page whose `Date` has stopped, so every poll here would spin until
   * the driver's own timeout. Which pins this survives is *A pinned clock* in the
   * package README, where an adopter will look for it.
   *
   * `performance.now()` is monotonic, measured from the document's own origin, and
   * where it is somehow absent the wall clock still beats no deadline at all.
   */
  const since = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const polls: ReturnType<typeof setTimeout>[] = [];

  const pollAgain = (tick: () => void): void =>
    void polls.push(setTimeout(tick, request.pollMs));

  const abandonPolls = (): void => {
    handedBack = true;
    for (const poll of polls) clearTimeout(poll);
    polls.length = 0;
  };

  const rootSelector = (): string | null => {
    for (const selector of request.roots) {
      const element = document.querySelector(selector);
      // Emptiness is part of the test. `#storybook-root` exists from the moment
      // the preview boots, so its mere presence says nothing about a story.
      if (element !== null && element.childElementCount > 0) return selector;
    }
    return null;
  };

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
   * How far Storybook's own render of this story has got, read from the
   * preview's `currentRender`.
   *
   * `over` once the render reached `completed` — where `storyRendered` is
   * emitted — or a later phase; `errored` for a render that failed; `pending`
   * while it is still loading, rendering or playing; `unknown` when the preview
   * exposes no render for this story, which is not evidence either way.
   */
  const renderState = (): 'over' | 'errored' | 'pending' | 'unknown' => {
    const current = scope.__STORYBOOK_PREVIEW__?.currentRender;
    if (current === undefined || current === null || current.id !== request.storyId) return 'unknown';
    switch (current.phase) {
      case 'completed':
      case 'afterEach':
      case 'finished':
        return 'over';
      case 'errored':
        return 'errored';
      case undefined:
        return 'unknown';
      default:
        return 'pending';
    }
  };

  /**
   * Wait for the subject to declare itself ready.
   *
   * The marker is the subject's own statement, so this asks nothing else of the
   * markup: a root that is still changing while the application says it is done
   * is the application's answer, and it outranks the observation.
   *
   * `alsoReady` is the framework's half of the evidence — already satisfied when
   * the story was rendered before this ran, or when there is no channel to hear
   * it from. Where a channel exists, both are waited for: the marker completes
   * `storyRendered`, it does not excuse it.
   *
   * The one thing this must never do is resolve `rendered` without the marker.
   * There is no fallback in here on purpose. Reaching the deadline is a timeout
   * that names the selector, because a configured marker that quietly became a
   * markup sample is a declared contract answered with a guess.
   */
  const settleByMarker = (
    selector: string,
    budgetMs: number,
    alsoReady: () => boolean,
    notes: readonly string[],
  ): Promise<ShowResult> =>
    new Promise<ShowResult>((resolve) => {
      const deadline = since() + budgetMs;

      const tick = (): void => {
        if (handedBack) return;

        const failed = overlay();
        if (failed !== null) {
          resolve(result('errored', 'none', { message: failed.message, stack: failed.stack, notes }));
          return;
        }

        const attached = document.querySelector(selector) !== null;
        if (attached && alsoReady()) {
          // Said on the way past, every time, because `declared` and
          // `storyRendered` are one word apart in a result and a world apart in
          // what they claim: one is the subject reporting that it has settled,
          // the other is the framework reporting that it called a function.
          resolve(
            result('rendered', 'declared', {
              notes: [
                ...notes,
                `readiness \`declared\`: the subject attached \`${selector}\` itself, which is the ` +
                  `application saying it has settled — a stronger claim than ` +
                  `\`${request.events.storyRendered}\`, where the framework says only that the story ` +
                  `function returned.`,
              ],
            }),
          );
          return;
        }

        if (since() >= deadline) {
          const missingRoot =
            rootSelector() === null ? `, and nothing mounted into ${request.roots.join(' or ')}` : '';
          resolve(
            result('timeout', 'none', {
              message: attached
                ? `the readiness marker \`${selector}\` was attached, but no ` +
                  `\`${request.events.storyRendered}\` arrived within ${budgetMs}ms`
                : `the readiness marker \`${selector}\` never appeared within ${budgetMs}ms` +
                  `${missingRoot}. A configured marker is not traded for weaker evidence: this run ` +
                  `asked the subject to declare readiness, so an undeclared story is a timeout.`,
              notes,
            }),
          );
          return;
        }

        pollAgain(tick);
      };

      tick();
    });

  const marker = request.readySelector;

  if (channel === null) {
    if (marker !== undefined) {
      // No channel means no `storyRendered` to wait for, so the marker is the
      // whole of the evidence.
      return settleByMarker(marker, request.timeoutMs, () => true, [
        `no Storybook channel was found on the preview window, so the framework's own signal was ` +
          `unavailable and readiness rested entirely on the configured marker \`${marker}\`.`,
      ]);
    }
    // Nothing on this page can say the story is ready, so it is not read. Markup
    // that stopped changing would be a guess at a story that may still be waiting
    // on a fetch, a font or an image. A story that crashed is still said so.
    const shown = overlay();
    return Promise.resolve(
      shown !== null ? result('errored', 'none', shown) : result('timeout', 'none', {
        message:
          `no Storybook channel was found on the preview window, so nothing said \`${request.storyId}\` ` +
          `was ready and it was not read. Configure \`readySelector\` with a marker the story ` +
          `attaches once it has settled.`,
      }),
    );
  }

  return new Promise<ShowResult>((resolve) => {
    const listeners: { event: string; handler: (payload: unknown) => void }[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Whether Storybook has said the story function returned. */
    let signalled = false;

    const release = (value: ShowResult, notes: readonly string[] = []): void => {
      // Listeners outlive the story: the page is not reloaded between subjects, so a
      // handler left attached answers for the *next* story too. Best-effort, because
      // the failures are not comparable: a detach this preview does not have costs a
      // stale listener; a throw here costs the run, leaving this promise unsettled.
      const detachNotes: string[] = [];
      const detach = typeof channel.off === 'function' ? channel.off : channel.removeListener;
      if (typeof detach !== 'function') {
        detachNotes.push(
          'the channel exposes neither `off` nor `removeListener`, so this session\'s listeners ' +
            'stay attached for the life of the preview document',
        );
      } else {
        for (const entry of listeners) {
          try {
            detach.call(channel, entry.event, entry.handler);
          } catch {
            detachNotes.push(`a \`${entry.event}\` listener could not be detached`);
          }
        }
      }
      const added = [...notes, ...detachNotes];
      resolve(added.length === 0 ? value : { ...value, warnings: [...value.warnings, ...added] });
    };

    /**
     * Hand the result back.
     *
     * A read is over when the driver has the result — but the *switch* to the
     * next story is not safe yet, because `storyRendered` is not the end of a
     * render. That wait is the driver's, in Node, over the record
     * `story-finished.ts` keeps; nothing here holds a result back for it. A
     * grace timer scheduled in page scope would be a timer on a page whose
     * clock the test may own, which is the one place a deadline must not live.
     */
    const finish = (value: ShowResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      abandonPolls();
      release(value);
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
      if (!mine(payload)) return;
      if (marker === undefined) {
        finish(result('rendered', 'storyRendered'));
        return;
      }
      // A marker was configured, so this event is no longer the finish line —
      // it is the framework's half of it. Storybook believing the story function
      // returned says nothing about a fetch on mount or an entry animation, and
      // finishing here would hand back exactly the mid-flight capture the marker
      // was configured to prevent. The marker poll closes this out.
      signalled = true;
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

    const failed = (error: unknown): void => {
      finish(result('unreachable', 'none', { message: String(error) }));
    };

    /**
     * The bound on Storybook's answer. Reaching it refuses the story and names
     * what did not arrive; it never reads the story anyway.
     */
    const bound = (selected: boolean): void => {
      timer = setTimeout(() => {
        const shown = overlay();
        if (shown !== null) {
          finish(result('errored', 'none', shown));
          return;
        }
        const unreadable = selected && renderState() === 'unknown'
          ? ', and the preview exposes no `currentRender` to say whether its render was already over'
          : '';
        finish(
          result('timeout', 'none', {
            message:
              `no \`${request.events.storyRendered}\` for \`${request.storyId}\` within ` +
              `${request.timeoutMs}ms${unreadable}, so it was not read`,
          }),
        );
      }, request.timeoutMs);
    };

    if (scope.__STORYBOOK_PREVIEW__?.currentSelection?.storyId === request.storyId) {
      // The first story of a session arrives selected by the URL, so its
      // `storyRendered` may have fired before this function was injected.
      // Storybook's `currentRender` says whether that render is already over;
      // the listeners above are attached first, so an event that lands while
      // this reads it is still heard.
      const state = renderState();
      if (state === 'errored') {
        finish(
          result('errored', 'none', overlay() ?? {
            message: `Storybook's render of \`${request.storyId}\` had already failed`,
          }),
        );
        return;
      }
      if (marker !== undefined) {
        // With no `currentRender`, an event that fired before this ran is lost,
        // and the marker is the evidence left.
        const told = (): boolean => signalled || state === 'unknown' || renderState() === 'over';
        settleByMarker(marker, request.timeoutMs, told, [
          `the story was already selected when this ran, so readiness waited on the subject's own ` +
            `marker \`${marker}\` and on Storybook's \`currentRender\`.`,
        ]).then(finish, failed);
        return;
      }
      if (state === 'over') {
        finish(
          rootSelector() === null
            ? result('no-root', 'none', {
                message: `the render finished and mounted nothing into ${request.roots.join(' or ')}`,
              })
            : result('rendered', 'already-rendered'),
        );
        return;
      }
      bound(true);
      return;
    }

    try {
      channel.emit(request.events.setCurrentStory, { storyId: request.storyId, viewMode: 'story' });
    } catch (error) {
      // Storybook's channel dispatches synchronously, so a story that throws
      // during render can throw straight back out of `emit`. Left unhandled that
      // rejects the evaluate and takes the rest of the run with it — precisely
      // the crashed run ADR-0020 forbids.
      const described = describeError(error);
      finish(
        result('errored', 'none', {
          message: `switching to the story threw: ${described.message}`,
          stack: described.stack,
        }),
      );
      return;
    }

    if (marker !== undefined) {
      // The marker owns the deadline, and reaching it is a timeout naming the
      // selector.
      settleByMarker(marker, request.timeoutMs, () => signalled, []).then(finish, failed);
      return;
    }

    bound(false);
  });
};
