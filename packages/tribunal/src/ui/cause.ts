/**
 * What each change hangs from — the file, or the property, that the commit changed.
 *
 * The docket grouped changes by *rung*: everything the diff declares under
 * **Edited**, everything an edited parent hands its inputs to under **Owner
 * edited**. That is the run's ladder printed as an index, and it is a category a
 * reviewer never has. Nobody opens a build to work through the components whose
 * cause is one hop away. They edited three files and they want to know what each
 * of the three did.
 *
 * So the row is the cause. `Button` moved because `ui/button.tsx` changed;
 * `CardFooter` moved because `ProductCard.tsx` changed and `ProductCard` draws it
 * through `Card`. Two rungs, one root each, and the roots are the commit —
 * three files in, three headings out, and a reviewer who reads them has read
 * their own change rather than a taxonomy of it.
 *
 * ## Why the root is a file the commit changed, and never a declaring file
 *
 * An owner is a root because the commit **edited** it. The file that *declares*
 * `MainNav` is the answer to a different question, and the two paths are the same
 * only when the commit happened to edit that file directly. Rooting under a
 * declaration the commit never touched would open a heading nobody wrote — the
 * page inventing a cause out of the source index — so a name whose file is not in
 * the change set gets a root under its own name and says so.
 *
 * ## An origin can hang from two roots, and it hangs from both
 *
 * The same `Button` is `edited` on the page whose file the diff names and
 * `upstream` on the page where a changed parent hands it a different label. That
 * is two causes for one component, and picking one would file a render under a
 * commit that did not produce it. It is listed under each, carrying the count of
 * renders that root explains — which is also the shape that keeps a partial
 * answer from reading as a whole one.
 */

import type { BuildDetail, MovementView } from '../review-types.js';
import type { Origin } from './grouping.js';

/** What kind of thing a root is, which decides how a heading draws it. */
export type RootKind = 'file' | 'token' | 'component';

/** One change under a root, and how much of it the root accounts for. */
export interface Rooted {
  readonly origin: Origin;
  /**
   * Renders this root explains, when it is not all of them.
   *
   * Absent is *all of them*, and it is absent rather than equal to the length so
   * that a row printing it has nothing to print in the ordinary case. Present
   * means the component moved for a second reason somewhere else, and the
   * heading above it accounts for this many of its renders and no more.
   */
  readonly of?: number;
}

/** A cause in the commit, and everything that moved because of it. */
export interface Root {
  readonly kind: RootKind;
  /** The path, the custom property, or the component name. */
  readonly name: string;
  readonly changes: readonly Rooted[];
  /** Renders under it, summed over the changes. */
  readonly renders: number;
}

/**
 * The commit's causes, and the changes no cause in it accounts for.
 *
 * `loose` is not a failure and is not small. It holds every change on a rung with
 * nothing in the commit at the top of it — nothing reaches it, nothing explains
 * it, the run read no diff — and those are the findings the docket ranks above
 * everything here. They keep their own bands.
 */
export function rootsOf(
  origins: readonly Origin[],
  build: BuildDetail,
): { readonly roots: readonly Root[]; readonly loose: readonly Origin[] } {
  const changedFiles = filesInCommit(build);
  const found = new Map<string, { kind: RootKind; name: string; changes: Rooted[] }>();
  const loose: Origin[] = [];

  for (const origin of origins) {
    const mine = new Map<string, number>();
    for (const { movement } of origin.appearances) {
      for (const at of rootsFor(movement, changedFiles)) {
        mine.set(at, (mine.get(at) ?? 0) + 1);
      }
    }

    if (mine.size === 0) {
      loose.push(origin);
      continue;
    }

    for (const [at, renders] of mine) {
      const [kind, name] = split(at);
      const root = found.get(at) ?? { kind, name, changes: [] };
      root.changes.push({
        origin,
        ...(renders === origin.appearances.length ? {} : { of: renders }),
      });
      found.set(at, root);
    }
  }

  const roots = [...found.values()]
    .map((root) => ({
      ...root,
      changes: [...root.changes].sort((left, right) =>
        left.origin.component.localeCompare(right.origin.component),
      ),
      renders: root.changes.reduce(
        (total, { origin, of }) => total + (of ?? origin.appearances.length),
        0,
      ),
    }))
    .sort(
      (left, right) => RANK.indexOf(left.kind) - RANK.indexOf(right.kind) ||
        left.name.localeCompare(right.name),
    );

  return { roots, loose };
}

/** Files first, then properties, then the owners whose file the commit misses. */
const RANK: readonly RootKind[] = ['file', 'token', 'component'];

function rootsFor(
  movement: MovementView | undefined,
  changed: ReadonlyMap<string, string>,
): readonly string[] {
  if (movement === undefined) return [];

  switch (movement.cause) {
    case 'edited':
      return movement.file === undefined ? [] : [at('file', movement.file)];
    case 'token':
      return (movement.tokens ?? []).map((token) => at('token', token));
    case 'upstream': {
      const owner = movement.upstream;
      if (owner === undefined) return [];
      const file = changed.get(owner);
      return [file === undefined ? at('component', owner) : at('file', file)];
    }
    default:
      return [];
  }
}

/**
 * Each component the commit reaches, mapped to the changed file it is reached by.
 *
 * The reach trail's head is a path the commit changed, which is the one this
 * needs. A component's own declaration wins when the commit changed that file
 * too, because a heading a reviewer recognises as *the file I edited* beats the
 * import at the top of the chain that led to it — and when the commit did not
 * change the declaring file, that path is not a cause and is not offered as one.
 */
function filesInCommit(build: BuildDetail): ReadonlyMap<string, string> {
  const changed = new Set(build.reach?.changed ?? []);
  const found = new Map<string, string>();

  for (const entry of build.reach?.components ?? []) {
    const head = entry.trail[0];
    if (head !== undefined && changed.has(head)) found.set(entry.component, head);
  }
  for (const cause of build.causes) {
    if (cause.file !== undefined && changed.has(cause.file)) found.set(cause.component, cause.file);
  }

  return found;
}

// The same separator, and for the same reason, as `attribution.ts`: a kind and a
// name joined by anything either half can contain is two roots that can collide.
// Written as the escape rather than as the byte, so the file stays greppable.
const IN = '\u0000';

function at(kind: RootKind, name: string): string {
  return `${kind}${IN}${name}`;
}

function split(key: string): [RootKind, string] {
  const cut = key.indexOf(IN);
  return [key.slice(0, cut) as RootKind, key.slice(cut + 1)];
}
