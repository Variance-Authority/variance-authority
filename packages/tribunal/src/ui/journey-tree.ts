/**
 * A family's journeys as one tree: a trunk, and a fork at every region where
 * its stories parted.
 *
 * The rows of a family are its divergence points in source order, and each is a
 * question every story answered — entered, did not, never had the module. Two
 * rows every story answered alike are one question asked twice: a handler and
 * the `setState` inside it part the same stories the same way, and are one
 * fork carrying two regions. Read left to right, the stories start as one
 * bundle and split at the first fork whose answers differ, and each bundle
 * splits again at the next fork that divides it, until every bundle is stories
 * that answered every fork alike. That is the tree, and the picture is the tree
 * with a y for every bundle.
 *
 * ## The trunk is the lattice's root
 *
 * Columns arrive in lattice order, so the first column is the story nothing
 * varies from, and the bundle holding it is the one drawn straight through:
 * `control` runs level and `sale-dark` forks off it, not the other way round.
 * At a fork, the branch that goes on straight is the one holding the trunk's
 * story, and the rest leave it above and below.
 */

import type { JourneyCell, JourneyColumn, JourneyFamily, JourneyRow } from './journeys.js';

/** One way the family split, and every region that split it that way, in source order. */
export interface Fork {
  readonly cells: readonly JourneyCell[];
  readonly rows: readonly JourneyRow[];
}

/** The rows folded by their answers, in the order the first of each appears. */
export function forksOf(rows: readonly JourneyRow[]): readonly Fork[] {
  const forks = new Map<string, { readonly cells: readonly JourneyCell[]; readonly rows: JourneyRow[] }>();
  for (const row of rows) {
    const key = row.cells.join(' ');
    const fork = forks.get(key);
    if (fork === undefined) forks.set(key, { cells: row.cells, rows: [row] });
    else fork.rows.push(row);
  }
  return [...forks.values()];
}

export interface Branch {
  /** The stories on it, in column order. */
  readonly stories: readonly JourneyColumn[];
  /** The fork it left at, or `-1` for the trunk. */
  readonly from: number;
  /** What its stories answered at `from`; `null` on the trunk. */
  readonly cell: JourneyCell | null;
  /** The fork it splits at, or the fork count when it runs to the end. */
  readonly at: number;
  /** The trunk's line: level, and never a fork's arm. */
  readonly main: boolean;
  /** Its own row in the picture, counted from the top. */
  readonly y: number;
  readonly branches: readonly Branch[];
}

export interface Tree {
  readonly root: Branch;
  /** How many branches run to the end: the picture's height in rows. */
  readonly leaves: number;
}

interface Bundle {
  readonly stories: readonly JourneyColumn[];
  readonly from: number;
  readonly cell: JourneyCell | null;
  readonly at: number;
  readonly children: readonly Bundle[];
}

/** Split at the first fork after `from` that divides the bundle, and recurse. */
function grow(
  stories: readonly JourneyColumn[],
  columns: readonly JourneyColumn[],
  forks: readonly Fork[],
  from: number,
  cell: JourneyCell | null,
): Bundle {
  for (let at = from + 1; at < forks.length; at++) {
    const fork = forks[at];
    if (fork === undefined) break;
    const groups = new Map<JourneyCell, JourneyColumn[]>();
    for (const story of stories) {
      const answer = fork.cells[columns.indexOf(story)] ?? 'absent';
      groups.set(answer, [...(groups.get(answer) ?? []), story]);
    }
    if (groups.size > 1) {
      const children = [...groups.entries()].map(([answer, group]) =>
        grow(group, columns, forks, at, answer),
      );
      return { stories, from, cell, at, children: centred(children, stories[0]) };
    }
  }
  return { stories, from, cell, at: forks.length, children: [] };
}

/** The child holding the trunk's story in the middle, so the rest fork both ways. */
function centred(children: readonly Bundle[], trunk: JourneyColumn | undefined): readonly Bundle[] {
  const index = children.findIndex((child) => child.stories.includes(trunk as JourneyColumn));
  if (index < 0) return children;
  const main = children[index] as Bundle;
  const rest = children.filter((_, i) => i !== index);
  const above = rest.slice(0, Math.ceil(rest.length / 2));
  return [...above, main, ...rest.slice(above.length)];
}

/** Every leaf gets the next row down; a bundle sits on the row of its trunk-side child. */
function place(
  bundle: Bundle,
  trunk: JourneyColumn | undefined,
  next: { y: number },
): { readonly branch: Branch; readonly y: number } {
  const main = trunk !== undefined && bundle.stories.includes(trunk);
  if (bundle.children.length === 0) {
    const y = next.y++;
    return { branch: { ...bundle, main, y, branches: [] }, y };
  }
  const placed = bundle.children.map((child) => place(child, trunk, next));
  const own = placed.find(({ branch }) => branch.stories.includes(bundle.stories[0] as JourneyColumn));
  const y = (own ?? placed[0])?.y ?? 0;
  return { branch: { ...bundle, main, y, branches: placed.map(({ branch }) => branch) }, y };
}

export function treeOf(family: JourneyFamily, forks: readonly Fork[]): Tree {
  const trunk = family.columns[0];
  const grown = grow(family.columns, family.columns, forks, -1, null);
  const next = { y: 0 };
  const { branch } = place(grown, trunk, next);
  return { root: branch, leaves: next.y };
}
