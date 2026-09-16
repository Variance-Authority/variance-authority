
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
  /**
   * How the manager changes a global, and how this adapter turns off work an
   * addon does on every story. See {@link PreviewGlobals}.
   */
  readonly updateGlobals: string;
  readonly storyRendered: string;
  /**
   * Emitted when a render reaches its `finished` phase — Storybook 8.3 and
   * later, absent before it.
   *
   * `storyRendered` is not the end of a render: `afterEach`, the reporting
   * phase, and anything an addon hangs off them all run after it. Storybook
   * treats a render it is being asked to replace while still in those phases as
   * stuck, and its last resort is to reload the entire preview
   * (`StoryRender.teardown`). A session that switches stories on
   * `storyRendered` therefore races a page reload on every subject, and a
   * reload takes everything injected into the page with it — which is not a
   * slow run but a run that stops observing after the first story whose
   * `afterEach` was slow. `@storybook/addon-a11y` with `test` set runs an axe
   * scan in exactly that phase, so this is the ordinary case rather than an
   * edge one.
   */
  readonly storyFinished: string;
  readonly storyThrewException: string;
  readonly storyErrored: string;
  readonly storyMissing: string;
  readonly playFunctionThrewException: string;
}

export const STORYBOOK_EVENTS: ShowEvents = {
  setCurrentStory: 'setCurrentStory',
  updateGlobals: 'updateGlobals',
  storyRendered: 'storyRendered',
  storyFinished: 'storyFinished',
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

/**
 * The preview's event channel, as the two Storybooks that ship one spell it.
 *
 * A declaration rather than an import: `showStory` is serialized into the page
 * and may name no value from this module, but types are erased before it goes.
 *
 * `off` is the modern spelling; Storybook 5's `Channel` shipped `removeListener`
 * and no alias for it. Both are optional, because the cost of assuming one is
 * not a degraded reading but a run that never ends — the detach happens inside
 * `release`, reached from a `setTimeout` callback, and a `TypeError` there
 * leaves the promise `showStory` handed back pending with nothing to settle it.
 */
export interface StoryChannel {
  on(event: string, handler: (payload: unknown) => void): void;
  off?(event: string, handler: (payload: unknown) => void): void;
  removeListener?(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload: unknown): void;
}

/** Where a preview hangs its channel, newest spelling first. */
export interface StorybookScope {
  readonly __STORYBOOK_PREVIEW__?: {
    readonly channel?: StoryChannel;
    readonly currentSelection?: { readonly storyId?: string };
  };
  readonly __STORYBOOK_ADDONS_CHANNEL__?: StoryChannel;
}

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

/**
 * Where the page keeps what it has seen Storybook finish.
 *
 * A window property rather than a closure, because the question outlives the
 * call that asks it: a story's result is handed back at `storyRendered`, and
 * whether Storybook then reached `finished` is asked afterwards, by a different
 * `evaluate` into the same document. A listener owned by the call that asked
 * would be installed too late to hear the answer.
 *
 * Read by the driver and shipped in the request, like every other constant here.
 */
export const FINISHED_RECORD_KEY = '__variance_authority_story_finished__';

/** What {@link beginFinishWatch} needs, since it can close over nothing. */
export interface FinishRequest {
  readonly key: string;
  readonly event: string;
  /** The story whose finish the driver is about to wait for. */
  readonly storyId: string;
}

/**
 * What the page has heard about `storyFinished`.
 *
 * `seen` is about the *preview* and not about any one story: a Storybook older
 * than 8.3 never emits the event at all, and telling that apart from a render
 * that is genuinely stuck is the difference between a warning worth reading and
 * a warning on every subject of every run. It is therefore never reset.
 *
 * `watching` and `hit` are one story's question. The driver names the story
 * before showing it and polls `hit` afterwards, so an event that arrives while
 * the result is still in flight — which is the usual case for a fast story — is
 * already written down by the time it is asked for.
 *
 * `absent` is written by the driver once it has waited out the grace on a page
 * that has never emitted the event, so no later story of that session pays the
 * same wait again.
 */
export interface FinishRecord {
  seen: boolean;
  watching: string | null;
  hit: boolean;
  absent: boolean;
  /**
   * What the finish said about the render, verbatim and unmapped.
   *
   * Storybook's own vocabulary — `'success'`, `'error'` — and `null` for a
   * preview that carries no status at all. Kept as the string it arrived as
   * because the adapter does not own this enumeration and a build that adds a
   * value to it should reach a reader, not be flattened on the way.
   */
  status: string | null;
}

/**
 * A reading of the watch, taken now, with Storybook's own answer beside it.
 *
 * {@link FinishRecord} is what the listener wrote down. `pending` is what the
 * preview says about *this instant*: whether the render it currently holds is in
 * one of the phases `StoryRender.isPending` names, which is the exact predicate
 * `teardown` consults before it reloads the document. The two are separate
 * questions and only one of them can be answered by remembering — a story that
 * was never re-selected has no render in flight and no finish coming, and
 * nothing the listener heard could tell those apart from a render that is stuck.
 *
 * `true` when the preview cannot be asked. An older Storybook, or one that moved
 * the property, leaves the driver where it was before this existed: waiting on
 * the event and saying so if it never comes.
 */
export interface FinishReading extends FinishRecord {
  pending: boolean;
}

/**
 * Globals set once per document, before any story is asked for.
 *
 * Storybook globals are how the manager toolbar changes a preview without
 * reloading it, and they are the supported way to tell an addon to stand down.
 * That is the whole use here: an addon that does work in `afterEach` does it on
 * every story of every run, and a run that is not asking its question is paying
 * for an answer it discards.
 *
 * **The default turns off `@storybook/addon-a11y`'s automatic scan, and only
 * that.** `a11y.manual` is the addon's own documented switch — the same one the
 * manager's "Accessibility" panel flips — so what it suppresses is the scan
 * this pass did not ask for, not the addon and not the project's configuration.
 * The reason it is the default rather than an opt-in: with `test` set the addon
 * runs axe in exactly the phase a session has to wait out, on every subject, and
 * a visual pass that pays that is slower for a result nobody reads.
 *
 * **This does not replace axe, and nothing here claims to.** A project's own
 * accessibility pass — `test-storybook`, the a11y addon in its own run, or axe
 * anywhere else — is untouched: globals set over the channel live in the preview
 * document this session opened and die with it. Suppressing the scan *inside*
 * VA's pass is the opposite of deleting the project's a11y config, which is the
 * thing an adopter must never be quietly asked to do.
 *
 * Pass `{}` to send nothing at all.
 */
export type PreviewGlobals = Readonly<Record<string, unknown>>;

export const DEFAULT_PREVIEW_GLOBALS: PreviewGlobals = { a11y: { manual: true } };

/** What {@link applyGlobals} needs, since it can close over nothing. */
export interface GlobalsRequest {
  readonly event: string;
  readonly globals: PreviewGlobals;
}
