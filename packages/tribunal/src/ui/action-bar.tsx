/**
 * The bar under a subject: where it sits in the queue, and the moves that cost
 * nothing to undo, each with its key.
 *
 * Laid out in the space the page leaves and never moving, so the walk through a
 * queue is one place. The verdict is not here: it sits at the top right of the
 * render, in [`decision.tsx`](./decision.tsx), and has a button and no key,
 * because a key that promotes a baseline is a key pressed by accident.
 *
 * While the concern form is open, J and K stand down wherever the focus is:
 * a reviewer who clicks the picture to look again has left the form but not the
 * draft. The buttons still move, because a click is not an accident.
 */

import type { ReactElement } from 'react';
import type { ConcernState } from '../concern-types.js';
import { useReading } from './reading.js';
import { useKeys, useKeysOn } from './keys.js';
import { number } from './text.js';

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
  place,
  writing = false,
  onSuspect,
  onGo,
}: {
  readonly place: Place | undefined;
  /** Whether the concern form is open on this render. */
  readonly writing?: boolean | undefined;
  /** Open the concern form, starting in this state. */
  readonly onSuspect: (state: ConcernState) => void;
  readonly onGo?: ((subject: string) => void) | undefined;
}): ReactElement {
  const go = (to: string | undefined): void => {
    if (to !== undefined) onGo?.(to);
  };

  const reading = useReading();
  const [keysOn, flipKeys] = useKeysOn();
  const walking = keysOn && !writing;
  useKeys(
    {
      ...(walking ? { j: () => go(place?.next), k: () => go(place?.previous) } : {}),
      ...(reading ? {} : { f: () => onSuspect('open'), i: () => onSuspect('investigating') }),
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

  return (
    <section className="va-actionbar" aria-label="What you can do with this render">
      <div className="va-actionbar-acts">
        {reading ? null : (
          <>
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
              Investigate {i.hint}
            </button>
          </>
        )}
      </div>

      <div className="va-actionbar-acts">
        {place === undefined ? null : (
          <span className="va-num">
            {place.at === undefined ? 'not in the queue' : `${number(place.at + 1)} of ${number(place.of)}`}
          </span>
        )}
        {onGo === undefined ? null : (
          <>
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
