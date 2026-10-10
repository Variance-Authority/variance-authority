/**
 * Single keys for the moves a reviewer makes forty times a build.
 *
 * A key is taken only when nothing else could want it: not while a field or a
 * form has the focus, not with a modifier held — Shift included, since that is
 * the browser's, or the system's — not when something earlier already handled
 * the press, and not as a held key repeats, which would run down the queue.
 *
 * A key is the letter it types, or on a layout whose letter is not Latin, the
 * Latin key in the same place: a reviewer typing Cyrillic still has J.
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
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  // Inside a form, a chip or its *Save* button has the focus between fields; a
  // J there would leave the page and drop the draft with it.
  return target.closest('form, input, textarea, select, [contenteditable]:not([contenteditable="false"])') === null;
}

/** The Latin letter a press stands for, lower case, or none. */
function letterOf(event: KeyboardEvent): string | undefined {
  // Caps Lock gives `J` with no Shift held; it is still the J key.
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  // `о` on a Russian layout is the key a Latin one types `j` with.
  return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : undefined;
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
      const letter = letterOf(event);
      const move = letter === undefined ? undefined : latest.current[letter];
      if (move === undefined) return;
      event.preventDefault();
      move();
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, [on]);
}
