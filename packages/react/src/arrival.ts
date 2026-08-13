import { boundariesUnder, type SuspenseBoundary } from './suspense.js';

/**
 * Waiting for a subject to arrive, and ruling on one that did not.
 *
 * `suspense.ts` reads the boundaries; this file is what a run *does* with the
 * reading, and the two are separate for a reason that outlived the line count.
 * The reading works anywhere a fiber does. The decision needs to know something
 * no page can see — whether an operator declared this subject's fallback to be
 * the subject — so it is a pure function on the driver's side, written once and
 * called by three surfaces, rather than a rule each of them re-derives.
 *
 * The policy itself is ADR-0037: a subject still waiting is **refused, not
 * captured**.
 */

export type SuspenseOutcome =
  /** Read, and nothing was waiting. The subject had arrived. */
  | 'settled'
  /** Read, and something was still waiting when the wait ran out. */
  | 'pending'
  /**
   * Nobody looked. No fiber at or under the node, so this is not a React
   * subject — or it is one this package could not find, which is the same
   * evidence. Never to be reported as `settled`: a page with no React and a page
   * that finished arriving are different facts, and a run that conflates them
   * declares every non-React subject to have waited successfully.
   */
  | 'unobserved';

export interface SuspenseSettlement {
  readonly outcome: SuspenseOutcome;
  /** How long `awaitSuspense` actually waited, in milliseconds. */
  readonly waitedMs: number;
  /** Boundaries found in the subtree at the last read, in any state. */
  readonly boundaries: number;
  /** Those still waiting when it gave up. Empty unless `outcome` is `pending`. */
  readonly pending: readonly SuspenseBoundary[];
}

export interface SuspenseWaitOptions {
  /**
   * Give up after this long. Defaults to 5000.
   *
   * `0` is a legitimate value and means *read once, wait for nothing* — which is
   * what a subject deliberately captured mid-arrival wants, and what an operator
   * who has decided this project should not wait on React at all asks for.
   */
  readonly timeoutMs?: number;
  /** How often to re-read. Defaults to 16, one frame. */
  readonly pollMs?: number;
  /**
   * Consecutive clean reads required before a subtree counts as settled.
   * Defaults to 2.
   *
   * The waterfall guard. A boundary resolving does not merely flip a field: it
   * commits children, and those children may suspend on a boundary that did not
   * exist a moment ago. Returning on the first clean read would photograph the
   * gap between the first spinner leaving and the second arriving — a capture
   * that is *neither* state, taken exactly once in a hundred runs, which is the
   * hardest kind of flake to attribute.
   */
  readonly confirmations?: number;
}

/** Long enough for a real request, short enough to fail a build the same day. */
const DEFAULT_SUSPENSE_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 16;
const DEFAULT_CONFIRMATIONS = 2;

/**
 * Wait until nothing under `node` is suspended, and say what was if it never is.
 *
 * The other tools in this category cannot ask this question, so they answer a
 * different one: take a screenshot, take another, compare, repeat. That poll is
 * in pixel space, so a fallback and its content that happen to occupy the same
 * box read as settled, and when it gives up it can name nothing — the output is
 * a timeout against a subject, not a boundary against a component.
 *
 * React holds the answer as a value on a fiber. So *is this page still arriving*
 * stops being a heuristic over images and becomes a read, and the failure gets a
 * subject: **this `<Suspense>`, written by this component, never resolved.**
 *
 * Returns rather than throws, for the reason `awaitQuiet` and `network.settle()`
 * do: what to do about a page that never finishes is the caller's decision, and
 * it needs the reading to make it. The caller that turns this into a red build
 * is `suspenseRefusal`.
 */
export async function awaitSuspense(
  node: Node,
  options: SuspenseWaitOptions = {},
): Promise<SuspenseSettlement> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SUSPENSE_TIMEOUT_MS;
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const confirmations = Math.max(1, options.confirmations ?? DEFAULT_CONFIRMATIONS);

  const started = now();
  let clean = 0;

  for (;;) {
    const boundaries = boundariesUnder(node);

    if (boundaries === null) {
      return { outcome: 'unobserved', waitedMs: now() - started, boundaries: 0, pending: [] };
    }

    const waiting = boundaries.filter((boundary) => boundary.state !== 'resolved');
    const waitedMs = now() - started;

    if (waiting.length === 0) {
      clean += 1;
      // A subtree holding no boundary at all has no waterfall to guard against
      // and is the overwhelmingly common case, so it pays nothing. Only a page
      // that actually uses Suspense pays for the confirmation read.
      if (boundaries.length === 0 || clean >= confirmations) {
        return { outcome: 'settled', waitedMs, boundaries: boundaries.length, pending: [] };
      }
    } else {
      clean = 0;
    }

    if (waitedMs >= timeoutMs) {
      return {
        outcome: waiting.length === 0 ? 'settled' : 'pending',
        waitedMs,
        boundaries: boundaries.length,
        pending: waiting,
      };
    }

    await sleep(pollMs);
  }
}

export interface LoadingDeclaration {
  /**
   * The operator declared this subject a capture of its *loading* state.
   *
   * The one escape hatch, and it is a declaration rather than a threshold: a
   * skeleton is a legitimate thing to hold a baseline over, and a suite that
   * could not express it would be pushing people towards suppressing the check
   * entirely.
   */
  readonly declaredLoading?: boolean;
  /** Named in the sentence, so a refusal identifies itself in a run's output. */
  readonly subjectId?: string;
}

/**
 * Why this subject must not be recorded, or `undefined` when it may be.
 *
 * The forced decision, and the shape is deliberate: `string | undefined`, like
 * `unresizable`, so a collector's use of it is one `if` and cannot silently
 * become a warning nobody reads.
 *
 * A subject that was still waiting is **refused, not captured**. Every other
 * outcome is worse in a way that costs somebody a day:
 *
 * - *Capture it anyway.* The baseline is now a spinner, approved by somebody who
 *   did not notice, and the first run on a faster machine reports the component
 *   arriving as a regression.
 * - *Capture it and warn.* Identical, plus a line in a log. The baseline is
 *   still wrong and the build is still green.
 * - *Wait longer.* A boundary that never resolves is not slow. The timeout is
 *   already the thing that distinguishes those two.
 *
 * Refusal is also symmetric, which is what keeps the escape hatch honest: a
 * subject declared to capture a loading state, that then settles, is refused
 * too. A declaration nobody deleted is a subject whose baseline flips between a
 * skeleton and a component depending on the weather — the same flake the
 * declaration was written to prevent, arriving from the other side.
 */
export function suspenseRefusal(
  settlement: SuspenseSettlement,
  declaration: LoadingDeclaration = {},
): string | undefined {
  const named = declaration.subjectId === undefined ? 'this subject' : `\`${declaration.subjectId}\``;

  if (declaration.declaredLoading === true) {
    if (settlement.outcome === 'pending') return undefined;

    const found =
      settlement.outcome === 'unobserved'
        ? 'no React tree was found under its root at all'
        : settlement.boundaries === 0
          ? 'it holds no Suspense boundary at all'
          : `all ${settlement.boundaries} of its Suspense boundaries had resolved ` +
            `after ${Math.round(settlement.waitedMs)}ms`;

    return (
      `${named} is declared as a loading-state capture, and ${found}. ` +
      'A declaration that no longer describes its subject is the same flake from ' +
      'the other side: what gets recorded now depends on how fast the machine is. ' +
      'Remove the declaration, or point it at the subject that still waits.'
    );
  }

  if (settlement.outcome !== 'pending') return undefined;

  const shown = settlement.pending.slice(0, 5).map(describeBoundary);
  const rest = settlement.pending.length - shown.length;

  return (
    `${named} was still waiting when it was read: ` +
    `${settlement.pending.length} Suspense boundary(s) had not resolved after ` +
    `${Math.round(settlement.waitedMs)}ms — ${shown.join('; ')}` +
    (rest > 0 ? `; and ${rest} more` : '') +
    '. This is a flake source: the same subject records a fallback on a slow run ' +
    'and its content on a fast one, and nobody wrote that difference. Fix what the ' +
    'boundary is waiting for, or declare this subject as a loading-state capture ' +
    'to record the fallback deliberately.'
  );
}

/**
 * One boundary, as much of it as React knew.
 *
 * Every clause is conditional because every source of it is: `createdBy` is
 * development-only, a key exists only if somebody wrote one, and a boundary at
 * the top of the subject has no owners. A sentence that printed `written by
 * undefined` would be this project reporting a field it does not have.
 */
function describeBoundary(boundary: SuspenseBoundary): string {
  const parts: string[] = [
    boundary.owners.length > 0
      ? `<Suspense> inside ${boundary.owners.join(' ← ')}`
      : '<Suspense> at the root of the subject',
  ];

  if (boundary.createdBy !== undefined) parts.push(`written by ${boundary.createdBy}`);
  if (boundary.key !== undefined) parts.push(`key ${boundary.key}`);
  if (boundary.depth > 0) parts.push(`nested ${boundary.depth} deep`);
  // A different problem with a different fix, and folding it into the same
  // sentence would send somebody to look for a request that was never made.
  if (boundary.state === 'dehydrated') parts.push('awaiting hydration, not data');

  return parts.join(', ');
}

function now(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
