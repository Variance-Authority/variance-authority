import { boundariesUnder, boundaryId, type SuspenseBoundary } from './suspense.js';

/**
 * Tell `note` each time a Suspense boundary on `page` shows its fallback and
 * each time it unlocks, as it happens, so a story places each where it fell:
 * between the request that went out and the one that came back, before the
 * click that waited for it.
 *
 * A boundary is named by the component that wrote it — in a production build,
 * which keeps no writer, the one it sits inside. React commits a boundary's
 * change to the page, so the boundaries are read after each change to the page,
 * and one that falls back and unlocks within one commit is not seen. A boundary
 * taken off the page is told nothing more. Returns what stops the watch.
 */
export function watchSuspense(page: Node, note: (text: string) => void): () => void {
  const Watch = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  if (typeof Watch !== 'function') return () => undefined;
  // The boundaries showing their fallback when the page last changed, by identity.
  let falling = new Set<number>();
  const read = (): void => {
    const now = new Set<number>();
    for (const boundary of boundariesUnder(page) ?? []) {
      const id = boundaryId(boundary);
      if (boundary.state === 'pending') {
        now.add(id);
        if (!falling.has(id)) note(`suspense ${named(boundary)} shows its fallback`);
      } else if (boundary.state === 'resolved' && falling.has(id)) {
        note(`suspense ${named(boundary)} unlocks`);
      }
    }
    falling = now;
  };
  const watch = new Watch(() => {
    try {
      read();
    } catch {
      // A page that cannot be read is not the story's failure.
    }
  });
  watch.observe(page, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => watch.disconnect();
}

/** A boundary by the component that wrote it, for it has no name of its own. */
function named(boundary: SuspenseBoundary): string {
  return [boundary.createdBy ?? boundary.owners[0], 'Suspense'].filter((part) => part !== undefined).join(' › ');
}
