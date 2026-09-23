import type { SearchIndex } from '../search-index.js';
import { termsOf } from '../search-index.js';

/**
 * The loose pass's membership, read off the published dictionary.
 *
 * This answers the set MiniSearch answered when the pass built an index per
 * question: every held name tokenized with MiniSearch's default tokenizer, terms
 * shorter than two dropped and the rest lowercased, then `combineWith: 'AND'`,
 * `prefix: true`, `fuzzy: 0.2` and `maxFuzzy: 1`. Each query term is satisfied
 * by any dictionary term equal to it, starting with it, or one edit from it
 * when the term is three characters or longer; a name is in the answer when
 * every query term is satisfied by its name or by the doc of a published row
 * the area admits.
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
 * file ids when given, admits a name through a row whose file is in it, and a doc
 * through the published row that carries it.
 */
export function looseNames(
  index: SearchIndex,
  query: string,
  fuzzy: number,
  within: ReadonlySet<number> | undefined,
  already: ReadonlySet<number>,
): ReadonlySet<number> {
  const terms = termsOf(query);
  if (terms.length === 0) return new Set();

  const heldCache = new Map<number, boolean>();
  const held = (name: number): boolean => {
    if (already.has(name)) return false;
    if (within === undefined) return true;
    let known = heldCache.get(name);
    if (known === undefined) {
      known =
        index.publishedOf(name).some((row) => within.has(index.publishedFile(row))) ||
        index.exportedOf(name).some((row) => within.has(index.exportedFile(row)));
      heldCache.set(name, known);
    }
    return known;
  };

  let answer: Set<number> | undefined;
  for (const term of terms) {
    const reached = new Set<number>();
    for (const id of matchingTerms(index, term, editsAllowed(term, fuzzy))) {
      for (const name of index.termNames(id)) if (held(name)) reached.add(name);
      for (const row of index.termPublished(id)) {
        const name = index.publishedName(row);
        if (already.has(name) || reached.has(name)) continue;
        if (within === undefined || within.has(index.publishedFile(row))) reached.add(name);
      }
    }
    answer = answer === undefined ? reached : new Set([...answer].filter((name) => reached.has(name)));
    if (answer.size === 0) break;
  }
  return answer ?? new Set();
}

/** Dictionary terms equal to `term`, starting with it, or within `edits` of it. */
export function matchingTerms(index: SearchIndex, term: string, edits: number): ReadonlySet<number> {
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
 * Terms within `edits` Levenshtein edits of `term`, in UTF-16 code units.
 *
 * The dictionary is sorted, so neighbouring terms share their prefix and share
 * the rows of the edit matrix that prefix computed. A prefix whose best cell
 * already exceeds the budget cannot recover, so every term under it is skipped
 * with one binary search — the walk a trie would make, over a sorted array.
 */
function withinEdits(index: SearchIndex, term: string, edits: number): readonly number[] {
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
function lowerBound(index: SearchIndex, wanted: Buffer, from: number): number {
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
function pastPrefix(index: SearchIndex, prefix: Buffer, from: number): number {
  let low = from + 1;
  let high = index.termCount;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (startsWith(index.termBytes(middle), prefix)) low = middle + 1;
    else high = middle;
  }
  return low;
}
