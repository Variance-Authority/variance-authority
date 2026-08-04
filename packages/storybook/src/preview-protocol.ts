
/**
 * What the driver and the page function both have to agree on.
 *
 * Its own module because it is the only thing the two halves of this adapter
 * share, and they cannot share anything else: the driver runs in Node and builds
 * a {@link ShowRequest}; `showStory` runs inside the browser, may import nothing
 * and may close over nothing, and is still typed by these declarations because
 * types are erased before it is serialized. A constant named here is therefore
 * *read by the driver and shipped in the request* — never referenced from page
 * scope, where it would arrive as a `ReferenceError`.
 *
 * The constants are configuration rather than knowledge. Every one of them is a
 * protocol or presentation detail of a package this one does not depend on, so a
 * project on a Storybook that renamed an event or restyled its error overlay can
 * say so in an option instead of forking the adapter.
 *
 * **Storybook's chrome is not the subject.** The story mounts into
 * `#storybook-root` (`#root` before Storybook 7), and that element — not the
 * preview `<body>` — is the subject root. Naming it correctly is this package's
 * whole contribution to ADR-0003: the preview reset, the `sb-*` layout classes,
 * and the error overlay all sit *outside* the subtree, so applicability pruning
 * drops every rule of theirs for the ordinary reason that it matches nothing in
 * the subject. Nothing here needs a Storybook-specific denylist, and that is the
 * point — a denylist would be a second ruleset, versioned by nobody.
 */

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
 * that uses them is serialized and shipped into the page (`showStory`, in
 * `show-story.ts`) — a module-scope constant would arrive as a `ReferenceError`.
 * Overridable so a project on a Storybook that renamed an event can say so
 * instead of forking.
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

/** Everything `showStory` needs, since it can close over nothing. */
export interface ShowRequest {
  readonly storyId: string;
  /** Budget for the story to signal that it rendered. */
  readonly timeoutMs: number;
  /** Interval between markup samples on the fallback path. */
  readonly pollMs: number;
  readonly events: ShowEvents;
  readonly roots: readonly string[];
  readonly errorOverlay: ErrorOverlay;
  /**
   * Selector for the readiness marker the *subject* attaches when it is settled.
   *
   * Absent means the feature is off and readiness is decided exactly as it was
   * before this existed. There is deliberately no default: a marker no project
   * agreed to attach would never appear, and inventing one would turn every
   * existing run into a suite of timeouts.
   *
   * Present means the marker decides. Readiness is not reached until this
   * selector matches — `storyRendered` having already fired does not shorten the
   * wait — and if it never matches, the result is a `timeout` naming it rather
   * than a capture taken on weaker evidence.
   */
  readonly readySelector?: string;
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
 * Ordered strongest first, and the order is the point: each rung knows strictly
 * less about the subject than the one above it.
 *
 * - `declared` — the subject said so itself: the configured readiness marker was
 *   attached by the application's own code. The strongest rung there is, because
 *   it is the only one reported by the thing that actually knows whether its
 *   fetches resolved, its effects ran, and its animation finished.
 * - `storyRendered` — Storybook said so. The only *framework* signal that knows
 *   about decorators, loaders, and async render phases — and still only a claim
 *   that the story function returned, not that the application settled.
 * - `already-rendered` — the story the URL selected was already in the document
 *   when this ran, so its `storyRendered` had already fired; readiness came from
 *   markup that stopped changing.
 * - `markup-quiescent` — the fallback: the root mounted and its markup was
 *   identical across two samples. Strictly weaker, and blind to anything that
 *   arrives later.
 * - `none` — nothing was ready; the status says what happened instead.
 */
export type Readiness =
  | 'declared'
  | 'storyRendered'
  | 'already-rendered'
  | 'markup-quiescent'
  | 'none';

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
