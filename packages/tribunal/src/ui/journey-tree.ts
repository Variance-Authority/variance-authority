/**
 * A family's journeys as one tree: a trunk, and a fork at every place its
 * stories parted.
 *
 * The rows of a family are its divergence points in source order, and each is a
 * question every story answered — entered, did not, never had the module. Read
 * left to right, the stories start as one bundle and split at the first row
 * whose answers differ, and each bundle splits again at the next row that
 * divides it, until every bundle is stories that answered every row alike.
 * That is the tree, and the picture is the tree with a y for every bundle.
 *
 * ## One decision is one fork
 *
 * The instrument records a decision as several regions. An `if` that returns
 * is its branch and the continuation after it; a handler and the `setState`
 * inside it part the same stories the same way. Drawn as they come, each would
 * be a second fork in the picture with nothing forking at it. So a row that
 * divides a bundle takes with it every later row the resulting bundles
 * answered alike, and the fork carries both.
 *
 * A `switch` is one decision with more than two answers. Its cases arrive as
 * consecutive rows of one declaration, and they are read together: the bundle
 * splits by what each story answered across all of them, so a loading story,
 * an error story and the two that fell through part at one mark with a branch
 * each. A chain of `if`s is not folded this way, because the code asks them one
 * at a time and the picture shows the order it asked.
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

/** One place the family parted, and every region that parted it there. */
export interface Fork {
  /** What divides the bundle: one region, or every case of one `switch`. */
  readonly rows: readonly JourneyRow[];
  /** Later regions the divided bundles answered alike, in source order. */
  readonly alike: readonly JourneyRow[];
}

export interface Branch {
  /** The stories on it, in column order. */
  readonly stories: readonly JourneyColumn[];
  /** The fork it left at, or `-1` for the trunk. */
  readonly from: number;
  /** Of the fork's dividing rows, the ones its stories entered; none on the trunk. */
  readonly entered: readonly JourneyRow[];
  /** The fork it splits at, or the count of forks drawn when it runs to the end. */
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
  /** Every fork in source order; `from` and `at` index it. */
  readonly forks: readonly Fork[];
}

interface Bundle {
  readonly stories: readonly JourneyColumn[];
  /** Index into `rows` of the fork it left at, or `-1`. */
  readonly from: number;
  readonly entered: readonly JourneyRow[];
  /** Index into `rows` of the fork it splits at, or `-1` when it runs to the end. */
  readonly key: number;
  readonly children: readonly Bundle[];
}

class Grower {
  /** Forks found so far, keyed by the index of their first dividing row. */
  readonly marks = new Map<number, { readonly rows: readonly JourneyRow[]; readonly alike: Set<number> }>();
  private readonly index: ReadonlyMap<JourneyColumn, number>;

  constructor(
    private readonly columns: readonly JourneyColumn[],
    private readonly rows: readonly JourneyRow[],
  ) {
    this.index = new Map(columns.map((column, at) => [column, at]));
  }

  private answer(row: number, story: JourneyColumn): JourneyCell {
    return this.rows[row]?.cells[this.index.get(story) ?? -1] ?? 'absent';
  }

  /** The stories grouped by what they answered across `at`, in the order the first of each appears. */
  private groups(stories: readonly JourneyColumn[], at: readonly number[]): readonly (readonly JourneyColumn[])[] {
    const groups = new Map<string, JourneyColumn[]>();
    for (const story of stories) {
      const key = at.map((row) => this.answer(row, story)).join(' ');
      groups.set(key, [...(groups.get(key) ?? []), story]);
    }
    return [...groups.values()];
  }

  /** `at` itself, or the whole run of consecutive cases of one declaration it sits in. */
  private decision(at: number): readonly number[] {
    const row = this.rows[at];
    if (row?.region?.kind !== 'case') return [at];
    const same = (other: number): boolean => {
      const candidate = this.rows[other];
      return candidate?.region?.kind === 'case' && candidate.file === row.file && candidate.region.name === row.region?.name;
    };
    let first = at;
    while (first > 0 && same(first - 1)) first--;
    let last = at;
    while (same(last + 1)) last++;
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }

  /** Split at the first row after `consumed` that divides the bundle, and recurse. */
  grow(stories: readonly JourneyColumn[], consumed: ReadonlySet<number>, from: number, entered: readonly JourneyRow[]): Bundle {
    for (let at = 0; at < this.rows.length; at++) {
      if (consumed.has(at)) continue;
      const decision = this.decision(at);
      const groups = this.groups(stories, decision);
      if (groups.length < 2) {
        at = decision[decision.length - 1] ?? at;
        continue;
      }

      const key = decision[0] ?? at;
      const taken = new Set([...consumed, ...decision]);
      const mark = this.marks.get(key) ?? { rows: decision.map((row) => this.rows[row] as JourneyRow), alike: new Set<number>() };
      this.marks.set(key, mark);
      for (let later = (decision[decision.length - 1] ?? at) + 1; later < this.rows.length; later++) {
        if (taken.has(later)) continue;
        const run = this.decision(later);
        // Divides this bundle, and no bundle it just became: the same question, asked again.
        const alike =
          this.groups(stories, run).length > 1 && groups.every((group) => this.groups(group, run).length === 1);
        if (alike) for (const row of run) {
          taken.add(row);
          mark.alike.add(row);
        }
        later = run[run.length - 1] ?? later;
      }

      const children = groups.map((group) =>
        this.grow(
          group,
          taken,
          key,
          decision.filter((row) => this.answer(row, group[0] as JourneyColumn) === 'entered').map((row) => this.rows[row] as JourneyRow),
        ),
      );
      return { stories, from, entered, key, children: centred(children, stories[0]) };
    }
    return { stories, from, entered, key: -1, children: [] };
  }
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

/**
 * Every leaf gets the next row down; a bundle sits on the row of its trunk-side
 * child. A bundle whose fork is past `shown` is a leaf: drawn to the edge,
 * its later forks counted but not drawn.
 */
function place(
  bundle: Bundle,
  order: ReadonlyMap<number, number>,
  shown: number,
  trunk: JourneyColumn | undefined,
  next: { y: number },
): { readonly branch: Branch; readonly y: number } {
  const main = trunk !== undefined && bundle.stories.includes(trunk);
  const from = order.get(bundle.from) ?? -1;
  const at = order.get(bundle.key) ?? shown;
  if (bundle.children.length === 0 || at >= shown) {
    const y = next.y++;
    return { branch: { stories: bundle.stories, from, entered: bundle.entered, at: shown, main, y, branches: [] }, y };
  }
  const placed = bundle.children.map((child) => place(child, order, shown, trunk, next));
  const own = placed.find(({ branch }) => branch.stories.includes(bundle.stories[0] as JourneyColumn));
  const y = (own ?? placed[0])?.y ?? 0;
  const branches = placed.map(({ branch }) => branch);
  return { branch: { stories: bundle.stories, from, entered: bundle.entered, at, main, y, branches }, y };
}

/** The family's tree, with at most `limit` forks drawn. */
export function treeOf(family: JourneyFamily, limit = Number.POSITIVE_INFINITY): Tree {
  const trunk = family.columns[0];
  const grower = new Grower(family.columns, family.rows);
  const grown = grower.grow(family.columns, new Set(), -1, []);

  const keys = [...grower.marks.keys()].sort((a, b) => a - b);
  const order = new Map(keys.map((key, at) => [key, at]));
  const forks = keys.map((key): Fork => {
    const mark = grower.marks.get(key);
    if (mark === undefined) return { rows: [], alike: [] };
    const alike = [...mark.alike].sort((a, b) => a - b).map((row) => family.rows[row] as JourneyRow);
    return { rows: mark.rows, alike };
  });

  const next = { y: 0 };
  const { branch } = place(grown, order, Math.min(forks.length, limit), trunk, next);
  return { root: branch, leaves: next.y, forks };
}
