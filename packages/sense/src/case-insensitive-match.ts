/**
 * The guard against a resolution the filesystem answered by ignoring case,
 * which [`resolve.ts`](./resolve.ts) applies to every path a resolver finds.
 */

import { basename } from 'node:path';

/**
 * A declaration file's name: `.d.ts`, `.d.mts` or `.d.cts` after a stem. The
 * stem ends where that suffix begins, so `./Context` finding `context.d.ts` is
 * a fold like any other, and not two names that differ at `.d`.
 */
export const DECLARATION = /.\.d\.[cm]?ts$/;

/**
 * Whether a resolution only succeeded because the filesystem ignores case.
 *
 * macOS and Windows match filenames without regard to case, so `./legacy.js` in a
 * directory holding `Legacy.tsx` resolves to `Legacy.tsx` — the file doing the
 * importing. The edge is a self-loop, the real `legacy.js` is left with no
 * dependents, and a change to it reaches nothing. Rejecting the fold sends the
 * request to a resolver that will not rewrite the extension, which finds the file
 * that was actually named.
 *
 * Only an *equal-but-for-case* stem counts. `./colors` finding `_colors.scss` and
 * `react` finding `index.js` are different names, resolved on purpose.
 */
export function caseFolded(request: string, resolved: string): boolean {
  const asked = stemOf(basename(request));
  const found = stemOf(basename(resolved));

  return asked !== found && asked.toLowerCase() === found.toLowerCase();
}

function stemOf(name: string): string {
  if (DECLARATION.test(name)) return name.slice(0, name.lastIndexOf('.d.'));
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}
