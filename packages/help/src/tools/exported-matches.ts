import { codeUnitOrder } from '@variance-authority/core/segment';
import type { SearchIndex } from '../search-index.js';
import { rowTextOrder } from './described.js';
import { rowWithin } from './loose.js';
import type { Said } from './held-sentence.js';
import type { ExportedMatch, Place } from './search-matches.js';

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
 * What the source index answers about the exported rows shown: `of`, the
 * declaration the export of `name` in `at` binds, and `passersOf`, for each
 * declaration asked, every file that passes it on, `export *` included. None
 * when the index does not read. Given to `head`, they show a name where it is
 * declared and at the barrel nearest its package's root that passes it on.
 */
export interface Declarations {
  of(at: string, name: string): (Place & { readonly name: string }) | undefined;
  passersOf(declared: readonly { readonly at: string; readonly name: string }[]): readonly (readonly string[])[] | undefined;
}

/**
 * Exported names given by id, nearest thing to a ranking.
 *
 * Grouped by name because one name exported from a barrel and from the file that
 * declares it is one thing to go and look at, and ordered by how many files
 * export it — which is the only count this half has — once `openings` has
 * said where the question was found. A name is shown and ranked through one
 * row: where its question was found first, then source before tests and
 * stories, so the place shown is the implementation rather than its exercise.
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
  said: Said,
  through?: ReadonlyMap<number, ReadonlySet<number>>,
  openings?: ReadonlySet<number>,
  exact?: ReadonlyMap<number, number>,
): { readonly total: number; head(count: number, declarations?: Declarations): readonly ExportedMatch[]; rows(): readonly number[] } {
  const found: { name: number; count: number; field: number }[] = [];
  // The file that exports it, against the closure. A name exported from a
  // barrel inside the area and declared outside it arrives here twice, under
  // two paths, and the one in the area is the one a reader can open.
  const rowsOf = (name: number): readonly number[] => {
    const all = index.exportedOf(name);
    return within === undefined ? [...all] : [...all].filter((row) => rowWithin(index, 'exported', row, within));
  };
  const reached = (name: number): readonly number[] => {
    const read = through?.get(name);
    return read === undefined ? rowsOf(name) : rowsOf(name).filter((row) => read.has(row));
  };

  // Where the question was found in one row of `name`: the name whole, then in
  // its words, then in the doc's opening, then later in the doc.
  const fieldOf = (name: number) => (row: number): number =>
    exact?.get(name) ?? (openings === undefined || through?.get(name) === undefined ? 2 : openings.has(row) ? 3 : 4);

  for (const name of names) {
    if (shown.has(name)) continue;
    const count = within === undefined ? index.exportedOf(name).length : rowsOf(name).length;
    if (count === 0) continue;
    // The field of the row it is shown through, the first by an order that
    // reads the field first: the least of its rows'.
    const field = reached(name).reduce((least, row) => Math.min(least, fieldOf(name)(row)), Number.MAX_SAFE_INTEGER);
    found.push({ name, count, field });
  }

  return {
    total: found.length,
    rows: () => found.flatMap(({ name }) => reached(name)),
    head: (count, declarations) => {
      const picked = first(found, count, (a, b) => a.field - b.field || b.count - a.count || a.name - b.name).flatMap(({ name, count: files }) => {
        // `count` is the number of these rows, so one is always chosen.
        const chosen = exportedShown(index, reached(name), fieldOf(name));
        if (chosen === undefined) return [];
        const row = index.exported(chosen);
        return [{ name, files, row, declared: declarations?.of(row.at, row.name) }];
      });
      const resolved = picked.flatMap((one) => (one.declared === undefined ? [] : [one.declared]));
      const passers = resolved.length === 0 ? undefined : declarations?.passersOf(resolved);
      return picked.map(({ name, files, row, declared }) => {
        const door = declared === undefined || passers === undefined ? undefined : doorOf(index, rowsOf(name), declared, passers[resolved.indexOf(declared)] ?? []);
        // The package that holds the file shown: the declaration's, when it exports the name.
        const by = declared === undefined ? row.by : (rowsOf(name).map((one) => index.exported(one)).find((one) => one.at === declared.at)?.by ?? row.by);
        // The row's own doc, or none: another row of the same name is another
        // file, whose comment says nothing about this one.
        const doc = row.doc;
        const match: ExportedMatch = {
          source: 'exported',
          name: row.name,
          ...(by === '' ? {} : { package: by }),
          at: declared?.at ?? row.at,
          line: declared?.line ?? row.line,
          ...(declared === undefined ? {} : { declared: true as const }),
          ...(door === undefined ? {} : { exportedFrom: door }),
          files,
          ...(doc === undefined ? {} : { summary: said(doc) }),
        };
        return match;
      });
    },
  };
}

/**
 * Of `passers`, the files that pass `declared` on, the one nearest the root
 * whose folder holds the declaring file: the barrel an importer of its package
 * reaches it through. Its line is its export row's, when it exports the name
 * itself; an `export *` has none. None when no barrel above passes it on.
 */
function doorOf(index: SearchIndex, rows: readonly number[], declared: Place, passers: readonly string[]): { readonly at: string; readonly line?: number } | undefined {
  const depth = (at: string): number => at.split('/').length;
  const holds = (at: string): boolean => at !== declared.at && declared.at.startsWith(at.slice(0, at.lastIndexOf('/') + 1));
  const at = passers.filter(holds).sort((a, b) => depth(a) - depth(b) || codeUnitOrder(a, b))[0];
  if (at === undefined) return undefined;
  const line = rows.map((row) => index.exported(row)).find((row) => row.at === at)?.line;
  return line === undefined ? { at } : { at, line };
}

/**
 * The order one name's exported rows are shown in: source before tests before
 * stories, then {@link rowTextOrder}, by what the rows say and never by where
 * the index wrote them, which follows file names. The kind column orders first,
 * so a row is read only at a tie on it.
 */
export const exportedOrder = (index: SearchIndex) => (a: number, b: number): number =>
  index.exportedKind(a) - index.exportedKind(b) || rowTextOrder(index, { kind: 'exported', row: a }, { kind: 'exported', row: b });

/**
 * The row of one name's `rows` an exported section ranks and shows it through:
 * the first by `field`, where the row holds the question, as the published
 * section's order reads it first, then by {@link exportedOrder}.
 */
function exportedShown(index: SearchIndex, rows: Iterable<number>, field: (row: number) => number): number | undefined {
  const order = exportedOrder(index);
  let chosen: number | undefined;
  for (const row of rows) if (chosen === undefined || (field(row) - field(chosen) || order(row, chosen)) < 0) chosen = row;
  return chosen;
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
    if (byName.has(name) || (within !== undefined && !rowWithin(index, 'exported', row, within))) continue;
    through.set(name, (through.get(name) ?? new Set()).add(row));
  }
  return through;
}
