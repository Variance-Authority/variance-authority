import { describedWordsNative, wordStemsNative } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { admittedBy, matchingTerms } from './loose.js';

// compass: variance-authority.report.agent-surface

/**
 * The repository's own names a description reaches, asked by the words the
 * dependency lexicon asks a package by.
 *
 * A description is not a name: `tsconfig custom conditions` is three words an
 * agent would say about `customConditionsFor`, and neither the phrase nor every
 * word is in it. So the question is cut into stems by the rule the installed
 * packages were cut by — the sense addon owns it, stopwords included — and a
 * name answers when its own words, or the documentation of a row that
 * publishes or exports it, hold at least half of the question's distinct stems. A dictionary term
 * stands for a stem when it reduces to it, so `files` stands for `file` and
 * `filter` does not.
 *
 * Ordered by counts, never a score: the question's words its name holds, then
 * the words it holds at all, then how many rows publish or export it, then the
 * name's own rank. The name comes first because a doc is a paragraph
 * and holds a word of almost anything; a name was chosen for what it does.
 */

/** One name the description reached, keyed by what it is ordered on. */
export interface DescribedName {
  readonly name: number;
  /** The question's words it holds, as the question wrote them, in stem order. */
  readonly words: readonly string[];
  /** How many of them its name holds. */
  readonly named: number;
  /** Rows that publish or export it. */
  readonly rows: number;
  readonly rank: number;
}

/**
 * Names holding at least half of the description's distinct stems, unordered;
 * `undefined` when the question has no word to describe — every word short or
 * a stopword — so it was not asked.
 *
 * `already` names are never reached. `within`, file ids when given, admits a
 * name through a row whose file is in it, and a doc through the published or
 * exported row that carries it — the loose pass's rule, for the same reason.
 */
export function describedNames(
  index: SearchIndex,
  query: string,
  within: ReadonlySet<number> | undefined,
  already: ReadonlySet<number>,
): readonly DescribedName[] | undefined {
  const asked = describedWordsNative(query);
  if (asked.length === 0) return undefined;

  const candidates = asked.map(([stem]) => [...matchingTerms(index, stem, 0)]);
  const stemmed = wordStemsNative(candidates.flat().map((term) => index.term(term)));

  const admits = admittedBy(index, within, already);

  // Per name, the positions of the asked stems it holds anywhere, and in its name.
  const held = new Map<number, Set<number>>();
  const named = new Map<number, Set<number>>();
  const mark = (into: Map<number, Set<number>>, name: number, position: number): void => {
    const positions = into.get(name) ?? new Set<number>();
    positions.add(position);
    into.set(name, positions);
  };
  let at = 0;
  asked.forEach(([stem], position) => {
    for (const term of candidates[position] ?? []) {
      if (stemmed[at++] !== stem) continue;
      for (const name of index.termNames(term)) {
        if (!admits(name)) continue;
        mark(held, name, position);
        mark(named, name, position);
      }
      for (const row of index.termPublished(term)) {
        const name = index.publishedName(row);
        if (already.has(name) || (within !== undefined && !within.has(index.publishedFile(row)))) continue;
        mark(held, name, position);
      }
      for (const row of index.termExported(term)) {
        const name = index.exportedName(row);
        if (already.has(name) || (within !== undefined && !within.has(index.exportedFile(row)))) continue;
        mark(held, name, position);
      }
    }
  });

  const needed = Math.ceil(asked.length / 2);
  const found: DescribedName[] = [];
  for (const [name, positions] of held) {
    if (positions.size < needed) continue;
    found.push({
      name,
      words: asked.filter((_, position) => positions.has(position)).map(([, word]) => word),
      named: named.get(name)?.size ?? 0,
      rows: index.publishedOf(name).length + index.exportedOf(name).length,
      rank: index.rank(name),
    });
  }
  return found;
}

/** Best first: name words, then words held, then rows, then rank. */
export const describedOrder = (a: DescribedName, b: DescribedName): number =>
  b.named - a.named || b.words.length - a.words.length || b.rows - a.rows || a.rank - b.rank;
