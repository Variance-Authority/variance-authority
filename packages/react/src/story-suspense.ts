import { tapCommits } from './commits.js';
import { boundariesUnder, boundaryId, type SuspenseBoundary } from './suspense.js';

/**
 * Tell `note` each time a Suspense boundary on `page` shows its fallback and
 * each time it unlocks, as it happens, naming it by the component that wrote it
 * or, in a production build, the one it sits inside. A boundary taken off the
 * page is told nothing more. Returns what stops the watch.
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
  // Read inside each commit, so a note precedes what is told after it and an empty fallback still counts; a boundary
  // that falls back and unlocks within one commit is not seen. React tells only a hook there before it loaded.
  // Only the moment of each commit is wanted, so the tap keeps none of them.
  const tap = tapCommits({ keep: 0, onCommit: read });
  return () => tap.stop();
}

function named(boundary: SuspenseBoundary): string {
  return [boundary.createdBy ?? boundary.owners[0], 'Suspense'].filter((part) => part !== undefined).join(' › ');
}
