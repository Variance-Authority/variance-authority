import type { FinishRecord, FinishRequest, FinishWatch } from './preview-protocol.js';

/**
 * The end of a render, watched from the page and decided in Node.
 *
 * `storyRendered` is not the end. Storybook's order is `playing` → `completing`
 * → `completed`, which is where that event is emitted, → `afterEach` →
 * `finished`, which is where `storyFinished` is. A render in any of the phases
 * between them counts as pending, and Storybook's answer to being asked to
 * replace a pending render is `StoryRender.teardown`: three macrotask ticks of
 * grace, then `window.location.reload()` and a promise that never resolves. The
 * reload takes the injected page agent with it, so the run does not slow down —
 * it stops observing. `@storybook/addon-a11y` with `test` set puts an axe scan
 * in exactly that phase, on every story, which is how an ordinary project meets
 * this on its first run.
 *
 * So a story is handed back at `storyRendered` and the *switch* waits for
 * `finished`. Two functions, because the two halves happen at different times:
 * the watch has to be open before the story is shown — a story that finishes
 * inside the round trip back to Node would otherwise be missed entirely — and
 * the question is asked after the result is already out.
 *
 * ## Why the deadline is not in here
 *
 * Nothing in this module sets a timer. The listener writes down what it heard
 * and settles whoever is waiting; `waitFinishRecord` answers when the finish
 * arrives, and not before. How long to keep asking is the driver's, in Node.
 *
 * That is not a style preference. The page's clock belongs to whoever is testing
 * — pinning it is the ordinary fix for a story built from `Date.now()`, and
 * `page.clock.install` replaces `setTimeout` outright and advances only when the
 * test ticks it. A grace timer scheduled in page scope on such a page never
 * fires, and the driver waits out its own timeout for a story that finished
 * immediately. An answer that arrives with the event needs no page timer, a
 * driver that holds the deadline owns it, and the page is left to be as strange
 * as the project needs it to be.
 *
 * Both functions are serialized to source text and evaluated in page scope, so
 * they may close over nothing and import nothing but types — every constant they
 * use arrives in the argument or is written out literally. `preview-protocol.ts`
 * holds the declarations; `FINISHED_RECORD_KEY` is read by the driver and
 * shipped in the request, never referenced from here.
 */

/**
 * Open the watch for one story. **Runs in page scope.**
 *
 * Installs the channel listener on first call and leaves it there: the listener
 * has to outlive the call that installs it, because the event it catches arrives
 * after that call's story has been handed back. Later calls only re-aim it,
 * naming the story now being shown and clearing the previous answer.
 *
 * An event carrying no story id is accepted rather than ignored. Only one story
 * renders at a time, and refusing an unlabelled event would hang every switch on
 * any Storybook that changed the payload's shape — a cosmetic version difference
 * turned into a timeout on every subject.
 *
 * Returns whether a channel was there to listen on. `false` means this preview
 * cannot be driven over the channel at all, which the driver already knows by
 * another route and does not need to wait on.
 */
export const beginFinishWatch = (request: FinishRequest): boolean => {
  const scope = window as unknown as {
    __STORYBOOK_PREVIEW__?: {
      channel?: { on(event: string, handler: (payload: unknown) => void): void };
      currentRender?: { id?: string; phase?: string } | null;
    };
    __STORYBOOK_ADDONS_CHANNEL__?: { on(event: string, handler: (payload: unknown) => void): void };
  } & Record<string, unknown>;

  const channel = scope.__STORYBOOK_PREVIEW__?.channel ?? scope.__STORYBOOK_ADDONS_CHANNEL__ ?? null;
  if (channel === null) return false;

  const existing = scope[request.key] as FinishWatch | undefined;
  if (existing !== undefined) {
    // Re-aiming at the story already recorded keeps the answer, because there is
    // no new render to have a new answer about. Storybook re-renders only a
    // story it is not already showing, so a subject read twice in one page — how
    // an order-dependent reading is told apart from a regression — is handed
    // back by the same render that already finished, and no second
    // `storyFinished` is coming. Clearing the record here is what makes a driver
    // wait out its whole budget for an event nobody will send, and then call a
    // story sitting finished on the screen one that is stuck.
    //
    // `isPending` is not the discriminator it looks like: `storyRendered` is
    // emitted at `completed`, which that predicate calls *not* pending, so a
    // render in the gap before `afterEach` is indistinguishable from one with
    // nothing left to do.
    if (existing.watching !== request.storyId) {
      existing.watching = request.storyId;
      existing.hit = false;
      existing.status = null;
    }
    return true;
  }

  // The first story of a document is selected by its URL, and its render can
  // reach `finished` before this runs — the event already sent, to nobody.
  // Storybook's `currentRender` still says so, and waiting on the event instead
  // would spend the whole budget and then write this preview down as one that
  // never emits it. What that finish said about the render is not recorded
  // anywhere, so its status is unknown rather than `success`.
  const current = scope.__STORYBOOK_PREVIEW__?.currentRender;
  const record: FinishWatch = {
    seen: false,
    watching: request.storyId,
    hit: current?.id === request.storyId && current.phase === 'finished',
    absent: false,
    status: null,
    waiters: [],
  };
  scope[request.key] = record;

  channel.on(request.event, (payload: unknown) => {
    record.seen = true;
    const id =
      typeof payload === 'string'
        ? payload
        : typeof payload === 'object' &&
            payload !== null &&
            typeof (payload as { storyId?: unknown }).storyId === 'string'
          ? (payload as { storyId: string }).storyId
          : null;
    if (id !== null && id !== record.watching) return;
    record.hit = true;
    const status =
      typeof payload === 'object' && payload !== null
        ? (payload as { status?: unknown }).status
        : undefined;
    record.status = typeof status === 'string' ? status : null;
    for (const wake of record.waiters.splice(0)) wake();
  });

  return true;
};

/**
 * Read what has been heard so far. **Runs in page scope.**
 *
 * `null` means no watch — a page with no channel, or one that was replaced by a
 * navigation since the watch was opened. Both are answers rather than errors:
 * the driver has nothing to wait for either way.
 */
export const readFinishRecord = (key: string): FinishRecord | null => {
  const record = (window as unknown as Record<string, FinishWatch | undefined>)[key];
  if (record === undefined) return null;
  const { seen, watching, hit, absent, status } = record;
  return { seen, watching, hit, absent, status };
};

/**
 * Answer once the story is finished. **Runs in page scope.**
 *
 * At once when the finish is already written down, when this preview is known
 * not to emit it, or when there is no watch; otherwise when the listener hears
 * it. Never on a timer: the driver races this against its own deadline and
 * reads the record once if the deadline comes first, for the reason the module
 * header gives. A waiter the driver stopped waiting on is settled by the next
 * finish the listener hears, and nobody is listening for its answer.
 */
export const waitFinishRecord = (key: string): Promise<FinishRecord | null> => {
  const record = (window as unknown as Record<string, FinishWatch | undefined>)[key];
  if (record === undefined) return Promise.resolve(null);
  const copy = (): FinishRecord => {
    const { seen, watching, hit, absent, status } = record;
    return { seen, watching, hit, absent, status };
  };
  if (record.hit || record.absent) return Promise.resolve(copy());
  return new Promise((resolve) => {
    record.waiters.push(() => resolve(copy()));
  });
};

/**
 * Write down that this preview does not emit the event. **Runs in page scope.**
 *
 * Storybook has emitted `storyFinished` since 8.3 and nothing before it does. On
 * an older preview the first story waits out the whole grace to learn that, and
 * this is what stops every later story of the session paying it again.
 */
export const markFinishAbsent = (key: string): void => {
  const record = (window as unknown as Record<string, FinishRecord | undefined>)[key];
  if (record !== undefined) record.absent = true;
};
