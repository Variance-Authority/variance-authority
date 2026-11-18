import { boundariesOfRoot, boundaryId, type SuspenseBoundary } from './suspense.js';

/**
 * What to read at each commit React makes, to tell `note` each Suspense boundary
 * of the committing root that began showing its fallback or unlocked since that
 * root's last commit, naming it by the component that wrote it or, in a
 * production build, the one it sits inside. A boundary taken off the page is
 * told nothing more.
 */
export function readSuspense(note: (text: string) => void): (root: object) => void {
  // The boundaries each root showed falling back at its last commit, by identity.
  const falling = new WeakMap<object, Set<number>>();
  return (root: object): void => {
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
}

function named(boundary: SuspenseBoundary): string {
  return [boundary.createdBy ?? boundary.owners[0], 'Suspense'].filter((part) => part !== undefined).join(' › ');
}
