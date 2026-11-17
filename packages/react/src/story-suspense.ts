import { tapCommits } from './commits.js';
import { boundariesUnder, boundaryId, type SuspenseBoundary } from './suspense.js';

/**
 * Tell `note` each time a Suspense boundary on `page` shows its fallback and
 * each time it unlocks, as it happens, so a story places each where it fell:
 * between the request that went out and the one that came back, before the
 * click that waited for it.
 *
 * A boundary is named by the component that wrote it — in a production build,
 * which keeps no writer, the one it sits inside. The boundaries are read inside
 * each commit React announces, so a note comes before anything told after that
 * commit, and a boundary whose fallback puts nothing on the page is told all the
 * same. One that falls back and unlocks within one commit is not seen. A
 * boundary taken off the page is told nothing more.
 *
 * React announces commits only to a hook that existed before `react-dom` loaded,
 * so a watch started after it, with no hook to wrap, tells nothing. Returns what
 * stops the watch.
 */
export function watchSuspense(page: Node, note: (text: string) => void): () => void {
  // The boundaries showing their fallback at the last commit, by identity.
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
  // Only the moment of each commit is wanted, so the tap keeps none of them.
  const tap = tapCommits({ keep: 0, onCommit: read });
  return () => tap.stop();
}

function named(boundary: SuspenseBoundary): string {
  return [boundary.createdBy ?? boundary.owners[0], 'Suspense'].filter((part) => part !== undefined).join(' › ');
}
