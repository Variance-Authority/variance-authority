/**
 * The bar under a subject: what is selected, where it sits, and what can be done
 * about it.
 *
 * Every move a reviewer has on a render used to live in the right-hand column,
 * at the height its card happened to sit: *Approve* at the top, *Looks
 * suspicious* one card down, and the way to the next render back in the rail on
 * the other side of the screen. A reviewer could not see what was on offer
 * without reading the column, and read it again on every render. The bar puts
 * all of it in one place that never moves, with the key for each, under the
 * picture it is about.
 *
 * Deciding has a button and no key. A key that promotes a baseline is a key
 * pressed by accident; moving between renders and opening a form cost nothing to
 * undo, and those are the ones a single letter reaches.
 */

import type { ReactElement } from 'react';
import type { ConcernState } from '../concern-types.js';
import type { Decision, SubjectView } from '../review-types.js';
import { useKeys, useKeysOn } from './keys.js';
import { causeOf } from './lead.js';
import { count, number } from './text.js';

/**
 * Where a render sits in the queue the rail draws.
 *
 * `at` is absent for a render the queue does not hold — one opened by a link,
 * whose verdict asks for nothing — rather than numbered as if it did.
 */
export interface Place {
  readonly at?: number | undefined;
  readonly of: number;
  readonly previous?: string | undefined;
  readonly next?: string | undefined;
}

export function ActionBar({
  subject,
  place,
  busy,
  onDecide,
  onSuspect,
  onGo,
}: {
  readonly subject: SubjectView;
  readonly place: Place | undefined;
  readonly busy: boolean;
  readonly onDecide: (decision: Decision) => void;
  /** Open the concern form, starting in this state. */
  readonly onSuspect: (state: ConcernState) => void;
  readonly onGo?: ((subject: string) => void) | undefined;
}): ReactElement {
  const go = (to: string | undefined): void => {
    if (to !== undefined) onGo?.(to);
  };

  const [keysOn, flipKeys] = useKeysOn();
  useKeys(
    {
      j: () => go(place?.next),
      k: () => go(place?.previous),
      f: () => onSuspect('open'),
      i: () => onSuspect('investigating'),
    },
    keysOn,
  );
  const key = (letter: string): ReactElement | null => (keysOn ? <kbd>{letter}</kbd> : null);

  const cause = causeOf(subject);

  return (
    <footer className="va-actionbar" aria-label="What you can do with this render">
      <p className="va-scope">
        <span className="va-scope-label">Selected</span>
        <b title={subject.subject}>{subject.subject}</b>
        <span>
          {cause ?? 'no component named'}
          {subject.regions.length === 0 ? '' : ` · ${count(subject.regions.length, 'region')}`}
        </span>
        {place === undefined ? null : (
          <span className="va-num">
            {place.at === undefined ? 'not in the queue' : `${number(place.at + 1)} of ${number(place.of)}`}
          </span>
        )}
      </p>

      <div className="va-actionbar-acts">
        <button type="button" className="va-suspicious" onClick={() => onSuspect('open')}>
          Looks suspicious {key('F')}
        </button>
        <button
          type="button"
          onClick={() => onSuspect('investigating')}
          title="Raise a concern that you are already looking into"
        >
          Flag as investigating {key('I')}
        </button>
        <span className="va-actionbar-gap" />
        <button
          type="button"
          className="va-approve"
          disabled={busy || !subject.approvable}
          onClick={() => onDecide('approved')}
          title={
            subject.approvable
              ? 'Make this build’s candidate the baseline'
              : 'This run kept no candidate image, so there is nothing to promote. Approving would mean rendering one now, which is recording rather than promoting.'
          }
        >
          Approve
        </button>
        <button type="button" className="va-reject" disabled={busy} onClick={() => onDecide('rejected')}>
          Reject
        </button>
        {onGo === undefined ? null : (
          <>
            <span className="va-actionbar-gap" />
            <button type="button" disabled={place?.previous === undefined} onClick={() => go(place?.previous)}>
              Previous {key('K')}
            </button>
            <button
              type="button"
              className="va-next"
              disabled={place?.next === undefined}
              onClick={() => go(place?.next)}
            >
              Next {key('J')}
            </button>
          </>
        )}
        <button
          type="button"
          className="va-keys"
          role="switch"
          aria-checked={keysOn}
          onClick={flipKeys}
          title="J, K, F and I, for anyone whose speech input or screen reader takes letters as its own"
        >
          Keys <span aria-hidden="true">{keysOn ? 'on' : 'off'}</span>
        </button>
      </div>
    </footer>
  );
}
