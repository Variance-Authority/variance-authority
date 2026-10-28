import { opening } from '@variance-authority/package/help';
import type { SearchIndex } from '../search-index.js';
import type { ExportedMatch } from './search-answer.js';

// compass: variance-authority.report.agent-surface

/** The first `count` of `items` under `before`, a total order, without sorting the rest. */
export function first<T>(items: readonly T[], count: number, before: (a: T, b: T) => number): T[] {
  const best: T[] = [];
  if (count <= 0) return best;
  for (const item of items) {
    const last = best[best.length - 1];
    if (best.length === count && last !== undefined && before(item, last) >= 0) continue;
    let low = 0;
    let high = best.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (before(best[middle] as T, item) <= 0) low = middle + 1;
      else high = middle;
    }
    best.splice(low, 0, item);
    if (best.length > count) best.pop();
  }
  return best;
}

/**
 * Exported names given by id, nearest thing to a ranking.
 *
 * Grouped by name because one name exported from a barrel and from the file that
 * declares it is one thing to go and look at, and ordered by how many files
 * export it — which is the only count this half has — once `openings` has
 * said where the question was found. Source before tests and
 * stories within a name, so the place shown first is the implementation rather
 * than something exercising it.
 *
 * `through` holds, for a name reached by a doc and not by its own words, the
 * rows whose doc was read: the row shown and the rows listed are among them,
 * since another file's `sum` says nothing about this one's. `files` still
 * counts every file that exports the name.
 *
 * `openings`, when given, are the rows whose doc says the question in its
 * opening paragraph, and where it was found then orders first, as the
 * published half orders: a name its own words reached, then one a doc opens
 * with, then one a doc says later. `exact` holds the names that are the question
 * whole and where each orders, before all of them.
 */
export function exported(
  index: SearchIndex,
  names: Iterable<number>,
  shown: ReadonlySet<number>,
  within: ReadonlySet<number> | undefined,
  through?: ReadonlyMap<number, ReadonlySet<number>>,
  openings?: ReadonlySet<number>,
  exact?: ReadonlyMap<number, number>,
): { readonly total: number; head(count: number): readonly ExportedMatch[]; rows(): readonly number[] } {
  const found: { name: number; rank: number; count: number; field: number }[] = [];
  // The file that exports it, against the closure. A name exported from a
  // barrel inside the area and declared outside it arrives here twice, under
  // two paths, and the one in the area is the one a reader can open.
  const rowsOf = (name: number): readonly number[] => {
    const all = index.exportedOf(name);
    return within === undefined ? [...all] : [...all].filter((row) => within.has(index.exportedFile(row)));
  };
  const reached = (name: number): readonly number[] => {
    const read = through?.get(name);
    return read === undefined ? rowsOf(name) : rowsOf(name).filter((row) => read.has(row));
  };

  for (const name of names) {
    if (shown.has(name)) continue;
    const count = within === undefined ? index.exportedOf(name).length : rowsOf(name).length;
    if (count === 0) continue;
    const read = openings === undefined ? undefined : through?.get(name);
    const field = exact?.get(name) ?? (read === undefined ? 2 : reached(name).some((row) => openings?.has(row) === true) ? 3 : 4);
    found.push({ name, rank: index.rank(name), count, field });
  }

  return {
    total: found.length,
    rows: () => found.flatMap(({ name }) => reached(name)),
    head: (count) =>
      first(found, count, (a, b) => a.field - b.field || b.count - a.count || a.rank - b.rank).flatMap(({ name, count: files }) => {
        // Source before tests before stories, and the first written within a
        // kind: the kind column orders the rows, and only the one shown is read.
        // `count` is the number of these rows, so one is always chosen.
        let chosen: number | undefined;
        for (const row of reached(name)) {
          if (chosen === undefined || index.exportedKind(row) < index.exportedKind(chosen)) chosen = row;
          if (index.exportedKind(chosen) === 0) break;
        }
        if (chosen === undefined) return [];
        const row = index.exported(chosen);
        // The row's own doc, or none: another row of the same name is another
        // file, whose comment says nothing about this one.
        const doc = row.doc;
        const match: ExportedMatch = {
          source: 'exported',
          name: row.name,
          ...(row.by === '' ? {} : { package: row.by }),
          at: row.at,
          line: row.line,
          files,
          ...(doc === undefined ? {} : { summary: opening(doc) }),
        };
        return [match];
      }),
  };
}

/**
 * The exported rows a doc reached, by name, in `within` when it is named: what
 * `exported` shows such a name through. A name in `byName` is left out, since
 * its own words reached every row of it.
 */
export function docRows(
  index: SearchIndex,
  rows: Iterable<number>,
  within: ReadonlySet<number> | undefined,
  byName: ReadonlySet<number>,
): Map<number, Set<number>> {
  const through = new Map<number, Set<number>>();
  for (const row of rows) {
    const name = index.exportedName(row);
    if (byName.has(name) || (within !== undefined && !within.has(index.exportedFile(row)))) continue;
    through.set(name, (through.get(name) ?? new Set()).add(row));
  }
  return through;
}
