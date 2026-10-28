import { wordStemsNative } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { tokensOf } from '../search-index.js';

/**
 * The loose pass's membership, read off the published dictionary.
 *
 * This answers the set MiniSearch answered when the pass built an index per
 * question: every held name tokenized with MiniSearch's default tokenizer, each
 * token kept whole and split into the words it is written in, terms shorter
 * than two dropped and the rest lowercased; the query tokenized without the
 * split; then `combineWith: 'AND'`,
 * `prefix: true`, `fuzzy: 0.2` and `maxFuzzy: 1`. Each query term is satisfied
 * by any dictionary term equal to it, starting with it, or one edit from it
 * when the term is three characters or longer; a name is in the answer when
 * every query term is satisfied by its name or by the doc of a published or
 * exported row the area admits.
 *
 * One edit, because the caller is an agent. An agent copies a name; it does
 * not mistype one. What it gets wrong is a letter of a name it recalled from
 * elsewhere: a plural, a case, one character. A wider budget answers a
 * human's slip and costs every agent a longer list of names it did not mean,
 * and a typo in the code is fixed in the code, not searched around.
 *
 * Only membership was ever read from MiniSearch — the tool orders what it
 * returns by its own rules — so scores are not reproduced. `loose.test.ts`
 * holds the two to the same sets.
 */

/** Sorted terms, by their UTF-8 bytes: the search file's dictionary, or any other kept by the same rule. */
export type Dictionary = Pick<SearchIndex, 'termCount' | 'term' | 'termBytes'>;

/** The most edits a term may be from what was asked: one character. */
const MAX_FUZZY = 1;

/** How far a term may be from what was typed, as MiniSearch computes it. */
export function editsAllowed(term: string, fuzzy: number): number {
  return Math.min(MAX_FUZZY, Math.round(term.length * fuzzy));
}

/**
 * Names reached loosely, as name ids.
 *
 * `already` names are never reached: the substring answered them. `within`,
 * file ids when given, admits a name and a doc only through a row
 * {@link rowWithin} the area.
 *
 * `through`, when given, receives the exported rows whose doc reached a name its
 * own words never did: the rows to show it through.
 */
export function looseNames(
  index: SearchIndex,
  query: string,
  fuzzy: number,
  within: ReadonlySet<number> | undefined,
  already: ReadonlySet<number>,
  through?: Map<number, Set<number>>,
): ReadonlySet<number> {
  const terms = tokensOf(query);
  if (terms.length === 0) return new Set();

  const held = admittedBy(index, within, already);
  const byName = new Set<number>();

  let answer: Set<number> | undefined;
  for (const term of terms) {
    const reached = new Set<number>();
    for (const id of matchingTerms(index, term, editsAllowed(term, fuzzy))) {
      for (const name of index.termNames(id)) {
        if (!held(name)) continue;
        reached.add(name);
        byName.add(name);
      }
      for (const row of index.termPublished(id)) {
        const name = index.publishedName(row);
        if (already.has(name) || reached.has(name)) continue;
        if (within === undefined || rowWithin(index, 'published', row, within)) reached.add(name);
      }
      for (const row of index.termExported(id)) {
        const name = index.exportedName(row);
        if (already.has(name) || (within !== undefined && !rowWithin(index, 'exported', row, within))) continue;
        reached.add(name);
        through?.set(name, (through.get(name) ?? new Set()).add(row));
      }
    }
    answer = answer === undefined ? reached : new Set([...answer].filter((name) => reached.has(name)));
    if (answer.size === 0) break;
  }
  for (const name of byName) through?.delete(name);
  return answer ?? new Set();
}

/**
 * Whether one row is the area's, `within` file ids: a published row when a file
 * of the area imports it, an exported row when the file exporting it is in the
 * area. A published name with no import site in an area is a name the area does
 * not use, however well it matches the question, and an exported row has no
 * import site to count. Every section asks this one question, so a name is
 * admitted, weighed and shown through the same rows.
 */
export function rowWithin(index: SearchIndex, kind: 'published' | 'exported', row: number, within: ReadonlySet<number>): boolean {
  return kind === 'published' ? index.siteFiles(row).some((file) => within.has(file)) : within.has(index.exportedFile(row));
}

/**
 * Whether a name may be reached through its own words: never when `already`
 * holds it, and inside `within` only through a row {@link rowWithin} it.
 * Remembered per name, because every matching term asks again.
 */
export function admittedBy(
  index: SearchIndex,
  within: ReadonlySet<number> | undefined,
  already: ReadonlySet<number>,
): (name: number) => boolean {
  const known = new Map<number, boolean>();
  return (name) => {
    if (already.has(name)) return false;
    if (within === undefined) return true;
    let admitted = known.get(name);
    if (admitted === undefined) {
      admitted =
        index.publishedOf(name).some((row) => rowWithin(index, 'published', row, within)) ||
        index.exportedOf(name).some((row) => rowWithin(index, 'exported', row, within));
      known.set(name, admitted);
    }
    return admitted;
  };
}

/** Dictionary terms equal to `term`, starting with it, or within `edits` of it. */
export function matchingTerms(index: Dictionary, term: string, edits: number): ReadonlySet<number> {
  const found = new Set<number>();
  const wanted = Buffer.from(term, 'utf8');
  for (let id = lowerBound(index, wanted, 0); id < index.termCount; id += 1) {
    if (!startsWith(index.termBytes(id), wanted)) break;
    found.add(id);
  }
  if (edits > 0) for (const id of withinEdits(index, term, edits)) found.add(id);
  return found;
}

/**
 * Per stem, the dictionary terms that reduce to it, by the dependency
 * lexicon's stemmer: the terms under the stem are read once and kept only
 * where they reduce to it, so `modul` admits `module` and not `modular`.
 */
export function termsOfStems(index: Dictionary, stems: readonly string[]): readonly (readonly number[])[] {
  const under = stems.map((stem) => [...matchingTerms(index, stem, 0)]);
  const reduced = wordStemsNative(under.flat().map((term) => index.term(term)));
  let at = 0;
  return under.map((terms, position) => terms.filter(() => reduced[at++] === stems[position]));
}

/**
 * Terms within `edits` Levenshtein edits of `term`, in UTF-16 code units.
 *
 * The dictionary is sorted, so neighbouring terms share their prefix and share
 * the rows of the edit matrix that prefix computed. A prefix whose best cell
 * already exceeds the budget cannot recover, so every term under it is skipped
 * with one binary search — the walk a trie would make, over a sorted array.
 */
function withinEdits(index: Dictionary, term: string, edits: number): readonly number[] {
  const width = term.length + 1;
  const rows: Int32Array[] = [Int32Array.from({ length: width }, (_, j) => j)];
  const found: number[] = [];
  let previous = '';
  let valid = 0;

  let id = 0;
  while (id < index.termCount) {
    const candidate = index.term(id);
    let depth = Math.min(commonPrefix(previous, candidate), valid);
    previous = candidate;
    let pruned = false;
    while (depth < candidate.length) {
      const above = rows[depth] as Int32Array;
      const row = (rows[depth + 1] ??= new Int32Array(width));
      const unit = candidate.charCodeAt(depth);
      row[0] = depth + 1;
      let best = row[0];
      for (let j = 1; j < width; j += 1) {
        const cost = term.charCodeAt(j - 1) === unit ? 0 : 1;
        const cell = Math.min((above[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (above[j - 1] ?? 0) + cost);
        row[j] = cell;
        if (cell < best) best = cell;
      }
      depth += 1;
      if (best > edits) {
        pruned = true;
        break;
      }
    }
    valid = depth;
    if (pruned) {
      // Cutting through a surrogate pair leaves no UTF-8 prefix to search by.
      const cut = candidate.charCodeAt(depth - 1);
      id = cut >= 0xd800 && cut <= 0xdbff
        ? id + 1
        : pastPrefix(index, Buffer.from(candidate.slice(0, depth), 'utf8'), id);
      continue;
    }
    if (((rows[depth] as Int32Array)[width - 1] ?? edits + 1) <= edits) found.push(id);
    id += 1;
  }
  return found;
}

function commonPrefix(a: string, b: string): number {
  const most = Math.min(a.length, b.length);
  let at = 0;
  while (at < most && a.charCodeAt(at) === b.charCodeAt(at)) at += 1;
  return at;
}

function startsWith(bytes: Buffer, prefix: Buffer): boolean {
  return bytes.length >= prefix.length && bytes.compare(prefix, 0, prefix.length, 0, prefix.length) === 0;
}

/** The first term at or after `from` whose bytes are not below `wanted`. */
function lowerBound(index: Dictionary, wanted: Buffer, from: number): number {
  let low = from;
  let high = index.termCount;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (Buffer.compare(index.termBytes(middle), wanted) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The first term after `from` that does not start with `prefix`; `from` does. */
function pastPrefix(index: Dictionary, prefix: Buffer, from: number): number {
  let low = from + 1;
  let high = index.termCount;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (startsWith(index.termBytes(middle), prefix)) low = middle + 1;
    else high = middle;
  }
  return low;
}
