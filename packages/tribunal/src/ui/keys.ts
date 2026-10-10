/**
 * Single keys for the moves a reviewer makes forty times a build.
 *
 * A key is taken only when nothing else could want it: not while a field has the
 * caret, not with a modifier held — that is the browser's, or the system's — and
 * not when something earlier already handled the press.
 */

import { useEffect, useRef } from 'react';

/** Whether a press was meant for the page rather than for a field or a shortcut. */
export function forThePage(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') === null;
}

/**
 * Bind lower-case keys to moves for as long as the caller is mounted.
 *
 * The bindings are read when a key is pressed, not when the listener was added,
 * so a caller can hand a fresh object every render without the listener being
 * taken down and put back each time.
 */
export function useKeys(bindings: Readonly<Record<string, () => void>>): void {
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    const listen = (event: KeyboardEvent): void => {
      if (!forThePage(event)) return;
      const move = latest.current[event.key];
      if (move === undefined) return;
      event.preventDefault();
      move();
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
}
