import { tapCommits } from './commits.js';
import { boundariesOfRoot, boundaryId, type SuspenseBoundary } from './suspense.js';

/**
 * Tell `note` each time a Suspense boundary React commits shows its fallback and
 * each time it unlocks, as it happens, naming it by the component that wrote it
 * or, in a production build, the one it sits inside. A boundary taken off the
 * page is told nothing more. Returns what stops the watch.
 */
export function watchSuspense(note: (text: string) => void): () => void {
  // The boundaries each root showed falling back at its last commit, by identity.
  const falling = new WeakMap<object, Set<number>>();
  const read = (root: object): void => {
    const was = falling.get(root) ?? new Set<number>();
    const now = new Set<number>();
    const { inSight, outOfSight } = boundariesOfRoot(root);
    // One out of sight keeps what it last showed, to be told unlocking when it comes back into sight.
    for (const boundary of outOfSight) if (was.has(boundaryId(boundary))) now.add(boundaryId(boundary));
    for (const boundary of inSight) {
      const id = boundaryId(boundary);
      if (boundary.state === 'pending') {
        now.add(id);
        if (!was.has(id)) note(`suspense ${named(boundary)} shows its fallback`);
      } else if (boundary.state === 'resolved' && was.has(id)) {
        note(`suspense ${named(boundary)} unlocks`);
      }
    }
    falling.set(root, now);
  };
  // The committing root is read inside its commit, so a note precedes what is told after it, an empty fallback still
  // counts and a root in a shadow root is read; a boundary that falls back and unlocks within one commit is not seen.
  // React tells only a hook there before it loaded.
  // Only the moment of each commit is wanted, so the tap keeps none of them.
  const tap = tapCommits({ keep: 0, onCommit: (_, root) => root !== undefined && read(root) });
  return () => tap.stop();
}

function named(boundary: SuspenseBoundary): string {
  return [boundary.createdBy ?? boundary.owners[0], 'Suspense'].filter((part) => part !== undefined).join(' › ');
}
