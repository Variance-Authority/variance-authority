/**
 * Refuse a path that is in neither the recording nor the checkout.
 *
 * Git owns what the checkout holds — tracked, or new and not ignored, the set
 * the source index is scanned from — and the recording what it recorded; a path
 * in either has an answer, even if the answer is that nothing entered it. A
 * path in neither is not held, and the refusal says so and names no other
 * path: two paths are two files. Every reader that takes a path from the
 * question asks this one function, so the refusal reads the same whichever
 * command it was typed into.
 */

// compass: variance-authority.report.agent-surface

import { checkoutListing, recordedPaths, type CheckoutListing } from '@variance-authority/sense';

/**
 * Throw when `path`, a file or a directory, is in neither the recording nor the
 * files git lists under `root`. A directory is a path here, since a reader such
 * as `slowest-tests` takes one. `listing` is what git lists at `path`, when the
 * caller has already asked; otherwise it is asked here.
 */
export function refuseUnknownPath(
  root: string,
  path: string,
  recorded: () => readonly string[],
  listing: CheckoutListing = checkoutListing(root, path),
): void {
  if (!('unread' in listing) && (listing.file || listing.directory)) return;
  const bare = path.endsWith('/') ? path.slice(0, -1) : path;
  if (recorded().some((known) => known === bare || known.startsWith(`${bare}/`))) return;
  throw new Error(
    `\`${path}\` is in neither the recording nor the files git lists under ${root}. ` +
      'Both name each file from the repository root.',
  );
}

/** The recording's paths under `root`, read once however many paths are asked about. */
export function recordedOnce(root: string): () => readonly string[] {
  let recorded: readonly string[] | undefined;
  return () => (recorded ??= recordedPaths(root));
}
