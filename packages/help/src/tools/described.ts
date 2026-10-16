import { codeUnitOrder } from '@variance-authority/core/segment';
import { declaredDescribedOf, describedWordsNative, wordStemsNative } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { declaredMatch } from './declared.js';
import type { DeclaredMatch } from './search-answer.js';
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
 * `filter` does not. A name its file declares and does not export is in no
 * row, so the source index answers for it by the same rule, its name and its
 * doc comment read in the sense addon.
 *
 * Ordered by counts, never a score: the question's words it holds at all, then
 * the ones its name holds, then how many rows publish or export it, then the
 * name's own rank. How much of the question is held comes first, the way a
 * search engine's coordination factor puts a document holding every term above
 * one holding half: a doc that says all of what was asked describes it better
 * than a name that says half. Between two that hold as much, the name decides,
 * since a name was chosen for what it does.
 */

/** What a reached name is ordered on. */
export interface DescribedKey {
  /** The question's words it holds, as the question wrote them, in stem order. */
  readonly words: readonly string[];
  /** How many of them its name holds. */
  readonly named: number;
  /** Rows that publish or export it. */
  readonly rows: number;
  readonly rank: number;
}

/** One name of the search index the description reached. */
export interface DescribedName extends DescribedKey {
  readonly name: number;
}

/** One declaration no export binds that the description reached: in no row, and ranked after every name that is. */
export interface DescribedDeclaration extends DescribedKey {
  readonly match: DeclaredMatch;
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

/**
 * The declarations no export binds, in `files` when they are named, whose name
 * and doc hold at least half of the description's distinct stems; `undefined`
 * when the question has no word to describe or no checkout was named, and when
 * its source index is absent or does not read, which the `declared` section
 * already says.
 */
export function describedDeclarations(
  root: string | undefined,
  query: string,
  files: Iterable<string> | undefined,
): readonly DescribedDeclaration[] | undefined {
  const asked = describedWordsNative(query);
  if (root === undefined || asked.length === 0) return undefined;
  let read: ReturnType<typeof declaredDescribedOf>;
  try {
    read = declaredDescribedOf(root, asked.map(([stem]) => stem as string), Math.ceil(asked.length / 2), files);
  } catch {
    return undefined;
  }
  return read?.names.map((one): DescribedDeclaration => {
    const held = new Set(one.held ?? []);
    return {
      match: declaredMatch(one),
      words: asked.filter((_, position) => held.has(position)).map(([, word]) => word as string),
      named: one.named ?? 0,
      rows: 0,
      rank: Number.MAX_SAFE_INTEGER,
    };
  });
}

/**
 * Best first: words held, then words in the name, then rows, then rank; a name
 * of the index before a declaration, and declarations by file, then line.
 */
export const describedOrder = (a: DescribedName | DescribedDeclaration, b: DescribedName | DescribedDeclaration): number =>
  b.words.length - a.words.length ||
  b.named - a.named ||
  b.rows - a.rows ||
  a.rank - b.rank ||
  ('match' in a ? 1 : 0) - ('match' in b ? 1 : 0) ||
  ('match' in a && 'match' in b ? codeUnitOrder(a.match.at, b.match.at) || a.match.line - b.match.line : 0);
