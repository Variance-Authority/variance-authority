import { boundariesUnder, type SuspenseBoundary } from './suspense.js';

/**
 * What a story line did to the Suspense boundaries on the page.
 *
 * A line that leaves a boundary showing its fallback is where a case that
 * times out began to wait, and the boundary is named by the component that
 * wrote it — in a production build, which keeps no writer, the one it sits
 * inside. A reader samples the page when each line ends, so a boundary that
 * opens and resolves within one line is not seen.
 */
export function lineReader(): () => string | undefined {
  let open: readonly string[] = [];
  let shownBefore = new Map<string, number>();
  return () => {
    const page = (globalThis as { document?: Document }).document;
    const boundaries = page === undefined ? [] : boundariesUnder(page) ?? [];
    const before = tally(open);
    open = boundaries.filter((boundary) => boundary.state !== 'resolved').map(named);
    const now = tally(open);
    const shown = tally(boundaries.filter((boundary) => boundary.state === 'resolved').map(named));
    let opened = 0;
    let resolved = 0;
    for (const [name, count] of now) opened += Math.max(0, count - (before.get(name) ?? 0));
    for (const [name, count] of before) {
      const left = count - (now.get(name) ?? 0);
      // Only a boundary newly showing its content resolved: one taken off the page did not.
      const appeared = (shown.get(name) ?? 0) - (shownBefore.get(name) ?? 0);
      if (left > 0 && appeared > 0) resolved += Math.min(left, appeared);
    }
    shownBefore = shown;
    const parts = [...(opened > 0 ? [`${opened} opened`] : []), ...(resolved > 0 ? [`${resolved} resolved`] : [])];
    if (parts.length === 0) return undefined;
    const still = open.length > 0 ? `, ${open.length} still open: ${open.join('; ')}` : '';
    return `suspense ${parts.join(', ')}${still}`;
  };
}

/** A boundary by the component that wrote it, for it has no name of its own. */
function named(boundary: SuspenseBoundary): string {
  return `${boundary.createdBy ?? boundary.owners[0] ?? 'root'} › Suspense`;
}

function tally(names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}
