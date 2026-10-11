import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';
import type { Help, Named } from '@variance-authority/package/help';
import { everyEntry, readHelp } from '@variance-authority/package/help';
import { SPACE_OR_PUNCTUATION, encodeSearchIndex, openSearchIndex } from '../search-index.js';
import { looseNames } from './loose.js';

/**
 * The loose pass answers the set MiniSearch answered.
 *
 * MiniSearch built an index per question; `loose.ts` reads the same membership
 * off the published dictionary. The reference here is MiniSearch configured as
 * the pass once configured it, with names and docs tokenized by `termsOf` —
 * each token whole and in its words — and the query by the split alone. The
 * dictionary itself is written by the sense addon, so a drift between the two
 * tokenizers, or in prefixing or edit distance, shows up as a name one side has
 * and the other does not.
 *
 * The fixture's own names are joined by exported names written to reach the
 * corners: punctuation inside a name, non-ASCII letters, a surrogate pair,
 * terms too short to index, and words split at a capital run and at digits.
 */

const LOWER = /^\p{Lowercase}$/u;
const UPPER = /^\p{Uppercase}$/u;
const DIGIT = /^\p{N}$/u;

/**
 * The words one token is written in, split where the case or a digit changes:
 * a lowercase letter before an uppercase one, the last capital of a run before
 * a lowercase letter, and a digit beside anything that is not one.
 * `parseHTTPResponse2` is `parse`, `HTTP`, `Response` and `2`; a token with
 * nowhere to split is one word.
 */
function wordsOf(token: string): readonly string[] {
  const chars = [...token];
  const words: string[] = [];
  let start = 0;
  for (let at = 1; at < chars.length; at += 1) {
    const before = chars[at - 1]!;
    const here = chars[at]!;
    const after = chars[at + 1];
    const split =
      (LOWER.test(before) && UPPER.test(here)) ||
      (UPPER.test(before) && UPPER.test(here) && after !== undefined && LOWER.test(after)) ||
      DIGIT.test(before) !== DIGIT.test(here);
    if (!split) continue;
    words.push(chars.slice(start, at).join(''));
    start = at;
  }
  words.push(chars.slice(start).join(''));
  return words;
}

/**
 * The term rule `help_search.rs` writes the dictionary with, restated as the
 * reference: each token whole and, when it is written in several words, each
 * word; a term shorter than two UTF-16 code units is dropped and the rest are
 * lowercased, once each.
 */
function termsOf(text: string): readonly string[] {
  const found = new Set<string>();
  for (const token of text.split(SPACE_OR_PUNCTUATION)) {
    if (token.length >= 2) found.add(token.toLowerCase());
    const words = wordsOf(token);
    if (words.length < 2) continue;
    for (const word of words) if (word.length >= 2) found.add(word.toLowerCase());
  }
  return [...found];
}

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/workspace');

const odd = (name: string): Named => ({
  name,
  at: 'packages/alpha/src/odd.ts',
  by: '@fixture/alpha',
  line: 1,
  type: false,
  kind: 'source',
});

const HELP: Help = (() => {
  const read = readHelp(WORKSPACE);
  const extra = ['größe', 'Größenordnung', 'naïveCache', 'x', 'a_b', 'emoji😀Name', 'measureAll', 'mesure', 'ÅngströmUnit', 'parseHTTPResponse2', 'v8Flags', 'ΣύνολοΤιμών'];
  return { ...read, exported: [...read.exported, ...extra.map(odd)] };
})();

const INDEX = openSearchIndex(encodeSearchIndex(HELP));

/** Every name with its docs, as the pass held them before it asked MiniSearch. */
function reference(query: string): ReadonlySet<string> {
  const held = new Map<string, string>();
  const keep = (name: string, doc: string): void => {
    const written = held.get(name) ?? '';
    held.set(name, doc === '' ? written : `${written} ${doc}`);
  };
  for (const [, , entry] of everyEntry(HELP)) keep(entry.name, entry.doc ?? '');
  for (const named of HELP.exported) keep(named.name, '');

  const mini = new MiniSearch<{ id: number; name: string; doc: string }>({
    fields: ['name', 'doc'],
    tokenize: (text) => [...termsOf(text)],
    processTerm: (term) => (term.length < 2 ? null : term.toLowerCase()),
    searchOptions: { tokenize: (text) => text.split(SPACE_OR_PUNCTUATION) },
  });
  const names = [...held.keys()];
  mini.addAll(names.map((name, id) => ({ id, name, doc: held.get(name) ?? '' })));
  const hits = mini.search(query, { combineWith: 'AND', fuzzy: 0.2, maxFuzzy: 1, prefix: true });
  return new Set(hits.map((hit) => names[hit.id as number] ?? ''));
}

const answered = (query: string): ReadonlySet<string> =>
  new Set([...looseNames(INDEX, query, 0.2, undefined, new Set())].map((id) => INDEX.name(id)));

/** Each dictionary term, whole and bent: cut short, one letter dropped, two swapped, one doubled. */
function queries(): readonly string[] {
  const out = new Set<string>([
    'numbers order', 'meesure', 'größe', 'grosse', 'naive', 'emoji', '😀', 'x', 'a b', '',
    'naive cache', 'cache', 'emoji name', 'measure all', 'all', 'ångström unit', 'unit', 'ordnung', 'größen',
    'parse http response', 'http', 'response 2', 'v8', 'flags', 'σύνολο τιμών',
  ]);
  for (let id = 0; id < INDEX.termCount; id += 1) {
    const term = INDEX.term(id);
    out.add(term);
    out.add(term.slice(0, Math.max(2, term.length - 2)));
    if (term.length > 3) {
      const at = term.length >> 1;
      out.add(term.slice(0, at) + term.slice(at + 1));
      out.add(term.slice(0, at - 1) + term[at] + term[at - 1] + term.slice(at + 1));
      out.add(term.slice(0, at) + term[at] + term.slice(at));
    }
  }
  return [...out];
}

describe('the loose pass against MiniSearch', () => {
  it('holds names with punctuation, non-ASCII letters and a surrogate pair', () => {
    expect(INDEX.termCount).toBeGreaterThan(20);
    expect(answered('größe')).toContain('größe');
  });

  it.each(queries())('answers %j with the names MiniSearch answers', (query) => {
    expect([...answered(query)].sort()).toEqual([...reference(query)].sort());
  });
});
