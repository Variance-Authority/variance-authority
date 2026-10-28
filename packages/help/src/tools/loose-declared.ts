import { declaredLooseOf, declaredTermsOf } from '@variance-authority/sense';
import { tokensOf } from '../search-index.js';
import { declaredMatch } from './declared.js';
import { editsAllowed, matchingTerms, type Dictionary } from './loose.js';
import type { DeclaredMatch } from './search-answer.js';

// compass: variance-authority.report.agent-surface

/**
 * The loose pass over the names a file keeps to itself.
 *
 * Those names are in no export list, so the search file's dictionary does not
 * hold them. The source index does: the sense addon cuts every harvested
 * top-level name into terms by the rule the search file cuts an exported one,
 * and hands back the distinct terms, sorted as that dictionary is. Each word
 * of the question is matched against them here, by `matchingTerms` — the one
 * rule, equal, prefix or one edit off — and the addon answers with the
 * declarations whose name holds a matched term for every word.
 *
 * A name is reached by its own words only, never by its doc: the loose pass
 * reaches an exported name through a doc so that a phrase split by other
 * words is found, and the described reading already reads a declaration's doc
 * for its words.
 */

/**
 * The declarations no export binds whose name the loose pass reaches for
 * `query`, in `files` when they are named, less the ones `already` holds as
 * `at:line:name`; `undefined` when no checkout was named, or its source index
 * is absent or does not read, which the `declared` section already says.
 */
export function looseDeclarations(
  root: string | undefined,
  query: string,
  fuzzy: number,
  files: Iterable<string> | undefined,
  already: ReadonlySet<string>,
): readonly DeclaredMatch[] | undefined {
  const words = tokensOf(query);
  if (root === undefined || words.length === 0) return undefined;
  const wanted = files === undefined ? undefined : [...files];
  try {
    const terms = declaredTermsOf(root, wanted);
    if (terms === undefined) return undefined;
    const dictionary = dictionaryOf(terms);
    const groups = words.map((word) => [...matchingTerms(dictionary, word, editsAllowed(word, fuzzy))].map((id) => dictionary.term(id)));
    if (groups.some((group) => group.length === 0)) return [];
    const read = declaredLooseOf(root, groups, wanted);
    return read?.names.map(declaredMatch).filter((one) => !already.has(declaredKey(one)));
  } catch {
    return undefined;
  }
}

/** A declaration as one key: two can share a name, never a file, a line and a name. */
export const declaredKey = (one: Pick<DeclaredMatch, 'at' | 'line' | 'name'>): string => `${one.at}:${one.line}:${one.name}`;

/** Terms already sorted by their UTF-8 bytes, read as a dictionary. */
function dictionaryOf(terms: readonly string[]): Dictionary {
  const bytes = terms.map((term) => Buffer.from(term, 'utf8'));
  return {
    termCount: terms.length,
    term: (id) => terms[id] ?? '',
    termBytes: (id) => bytes[id] ?? Buffer.alloc(0),
  };
}
