import { tapCommits, type TapRefusal } from '@variance-authority/react';
import type { AttentionDraft } from './access.js';
import { snapshotNode } from './snapshot.js';

/**
 * The half of Eyes that only code running beside the application can perform.
 *
 * A query wrapper sees what the test asked for. It does not see the click that
 * removed the element, and it does not see React commit. Both entry points
 * install what is below — the Playwright agent as an init script, the RTL entry
 * point in the runner's own realm — so the watched events and the turn in which
 * a target is copied are one thing rather than two that drift apart. A record
 * whose contents depend on which driver produced it cannot be read by anything
 * downstream that does not already know which driver that was.
 */

/**
 * The DOM events a capture-phase listener records.
 *
 * User-facing events only. A store mutation, a network response, a timer, or a
 * direct call emits none of these, and Eyes does not classify one as an action
 * on the strength of having noticed it.
 */
const EVENTS = [
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'keydown',
  'keyup',
  'input',
  'change',
  'submit',
  'focusin',
  'focusout',
  'dragstart',
  'drop',
] as const;

/**
 * Where an observation goes.
 *
 * Synchronous by signature. An entry point that has to hand the value to another
 * realm wraps this and owns the failure of doing so; nothing here may leave a
 * rejection behind in the application under test.
 */
export type RecordAttention = (attention: AttentionDraft) => void;

/**
 * Listen on one document in the capture phase; the returned function stops.
 *
 * Capture phase because React delegates from the root container: the target is
 * copied before the application receives the event, and therefore before a
 * handler can unmount the element it fired on. Moving this to the bubble phase
 * would produce the same record for every target except the ones worth having.
 */
export function observeDocumentEvents(document: Document, record: RecordAttention): () => void {
  const observe = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;

    record({
      kind: 'document-event',
      event: event.type,
      trusted: event.isTrusted,
      target: snapshotNode(target),
    });
  };

  for (const type of EVENTS) document.addEventListener(type, observe, { capture: true });

  return () => {
    for (const type of EVENTS) document.removeEventListener(type, observe, { capture: true });
  };
}

/** An attached commit tap, or the reason there is not one. */
export interface CommitObservation {
  /** Absent when the tap attached. A log carrying neither has heard nothing. */
  readonly refusal: TapRefusal | undefined;
  stop(): void;
}

/**
 * Record every React commit as attention.
 *
 * `createHook` is the whole difference between the two entry points, which is
 * why it has no default here. The page agent runs before any application module
 * and may install the hook `react-dom` will later find; a caller reached through
 * an import of the application's own React cannot, and says so — see
 * `TapRefusal` in `@variance-authority/react`.
 */
export function observeReactCommits(
  record: RecordAttention,
  options: { readonly createHook: boolean },
): CommitObservation {
  const tap = tapCommits({
    createHook: options.createHook,
    onCommit: (commit) => {
      record({ kind: 'react-commit', commit });
    },
  });

  return { refusal: tap.reason, stop: tap.stop };
}
