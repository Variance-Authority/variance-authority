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
 * While a concern is being written, J and K stand down wherever the focus is:
 * a reviewer who clicks the picture to look again has left the form but not the
 * draft. The buttons still move, because a click is not an accident.
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

interface Shortcut {
  readonly shortcut?: string;
  readonly hint: ReactElement | null;
}

export function ActionBar({
  subject,
  place,
  busy,
  writing = false,
  onDecide,
  onSuspect,
  onGo,
}: {
  readonly subject: SubjectView;
  readonly place: Place | undefined;
  readonly busy: boolean;
  /** Whether a concern is half written on this render. */
  readonly writing?: boolean | undefined;
  readonly onDecide: (decision: Decision) => void;
  /** Open the concern form, starting in this state. */
  readonly onSuspect: (state: ConcernState) => void;
  readonly onGo?: ((subject: string) => void) | undefined;
}): ReactElement {
  const go = (to: string | undefined): void => {
    if (to !== undefined) onGo?.(to);
  };

  const [keysOn, flipKeys] = useKeysOn();
  const walking = keysOn && !writing;
  useKeys(
    {
      ...(walking ? { j: () => go(place?.next), k: () => go(place?.previous) } : {}),
      f: () => onSuspect('open'),
      i: () => onSuspect('investigating'),
    },
    keysOn,
  );
  // The words name the button and the key is announced apart, as a shortcut, so
  // a screen reader says *Next* rather than *Next J*.
  const key = (letter: string, live = keysOn): Shortcut =>
    live ? { shortcut: letter, hint: <kbd aria-hidden="true">{letter}</kbd> } : { hint: null };
  const f = key('F');
  const i = key('I');
  const k = key('K', walking);
  const j = key('J', walking);

  const cause = causeOf(subject);

  return (
    <section className="va-actionbar" aria-label="What you can do with this render">
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
        <button
          type="button"
          className="va-suspicious"
          aria-keyshortcuts={f.shortcut}
          onClick={() => onSuspect('open')}
        >
          Looks suspicious {f.hint}
        </button>
        <button
          type="button"
          aria-keyshortcuts={i.shortcut}
          onClick={() => onSuspect('investigating')}
          title="Raise a concern that you are already looking into"
        >
          Flag as investigating {i.hint}
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
            <button
              type="button"
              aria-keyshortcuts={k.shortcut}
              disabled={place?.previous === undefined}
              onClick={() => go(place?.previous)}
            >
              Previous {k.hint}
            </button>
            <button
              type="button"
              className="va-next"
              aria-keyshortcuts={j.shortcut}
              disabled={place?.next === undefined}
              onClick={() => go(place?.next)}
            >
              Next {j.hint}
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
    </section>
  );
}
