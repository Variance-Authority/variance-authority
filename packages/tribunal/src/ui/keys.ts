/**
 * Single keys for the moves a reviewer makes forty times a build.
 *
 * A key is taken only when nothing else could want it: not while a field or a
 * form has the focus, not with a modifier held — that is the browser's, or the system's — and
 * not when something earlier already handled the press.
 *
 * And not at all once the reviewer turns them off. A single letter on the whole
 * window is what speech input types by accident and what a screen reader's
 * browse mode reads as its own command, so WCAG 2.1.4 asks for a way to turn
 * such keys off; the choice is kept per browser, like any other preference.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORED = 'va-keys';

/** Whether single keys are on in this browser, and the switch that flips it. */
export function useKeysOn(): readonly [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(STORED) !== 'off';
    } catch {
      return true;
    }
  });
  const flip = useCallback(() => {
    setOn((was) => {
      try {
        window.localStorage.setItem(STORED, was ? 'off' : 'on');
      } catch {
        // A browser that keeps nothing still flips for this page.
      }
      return !was;
    });
  }, []);
  return [on, flip];
}

/** Whether a press was meant for the page rather than for a field or a shortcut. */
export function forThePage(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  // Inside a form, a chip or its *Save* button has the focus between fields; a
  // J there would leave the page and drop the draft with it.
  return target.closest('form, input, textarea, select, [contenteditable]:not([contenteditable="false"])') === null;
}

/**
 * Bind lower-case keys to moves for as long as the caller is mounted.
 *
 * The bindings are read when a key is pressed, not when the listener was added,
 * so a caller can hand a fresh object every render without the listener being
 * taken down and put back each time.
 */
export function useKeys(bindings: Readonly<Record<string, () => void>>, on = true): void {
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    if (!on) return;
    const listen = (event: KeyboardEvent): void => {
      if (!forThePage(event)) return;
      // Caps Lock gives `J` with no Shift held; it is still the J key.
      const move = latest.current[event.key.toLowerCase()];
      if (move === undefined) return;
      event.preventDefault();
      move();
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, [on]);
}
