import { boundariesUnder, boundaryId, type SuspenseBoundary } from './suspense.js';

/**
 * What a story line did to the Suspense boundaries on the page.
 *
 * A line that leaves a boundary showing its fallback is where a case that
 * times out began to wait, and the boundary is named by the component that
 * wrote it — in a production build, which keeps no writer, the one it sits
 * inside. The case's last line also says which were still open when its body
 * settled, so readings that threw waiting differ from those that waited and
 * went on. A reader samples the page when each line ends, so a boundary that
 * opens and resolves within one line is not seen.
 */
export function lineReader(): (line?: { last?: boolean }) => string | undefined {
  // The boundaries open when the last line ended, by identity.
  let open = new Set<number>();
  return (line) => {
    const page = (globalThis as { document?: Document }).document;
    const boundaries = page === undefined ? [] : boundariesUnder(page) ?? [];
    const now = new Set<number>();
    const still: string[] = [];
    let opened = 0;
    let resolved = 0;
    for (const boundary of boundaries) {
      const id = boundaryId(boundary);
      if (id === undefined) continue;
      if (boundary.state === 'resolved') {
        if (open.has(id)) resolved += 1;
        continue;
      }
      now.add(id);
      still.push(named(boundary));
      if (!open.has(id)) opened += 1;
    }
    open = now;
    const parts = [...(opened > 0 ? [`${opened} opened`] : []), ...(resolved > 0 ? [`${resolved} resolved`] : [])];
    const last = line?.last === true && still.length > 0;
    if (parts.length === 0 && !last) return undefined;
    const listed = still.length > 0 ? `${still.length} still open${last ? ' at the end' : ''}: ${still.join('; ')}` : '';
    return `suspense ${[...parts, ...(listed === '' ? [] : [listed])].join(', ')}`;
  };
}

/** A boundary by the component that wrote it, for it has no name of its own. */
function named(boundary: SuspenseBoundary): string {
  return [boundary.createdBy ?? boundary.owners[0], 'Suspense'].filter((part) => part !== undefined).join(' › ');
}
