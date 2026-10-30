import { PARAGRAPH_BREAK } from '@variance-authority/package/help';
import { wordStemsNative } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { tokensOf } from '../search-index.js';
import { termsOfStems } from './loose.js';

// compass: variance-authority.report.agent-surface

/** The rows of one kind whose doc says a question, ascending, and those of them that say it in their opening paragraph. */
export interface DocsSaying {
  readonly rows: readonly number[];
  readonly openings: ReadonlySet<number>;
}

/**
 * The published and exported rows whose doc says `query`: holds it as typed,
 * case aside, or, for a question of two words or more, writes its words in
 * order, each next to the last within one paragraph. Both are read as the index
 * read every doc — {@link tokensOf}, so punctuation is no word and a letter
 * alone, the `s` of a possessive, is dropped — and each word by its stem, the
 * rule the dictionary's terms are matched by. So "the page's sink" writes
 * `page sink`, and "the sink of a page" and "a page and its sink" do not.
 *
 * Only a doc holding a term of every word's stem is decoded, read off the
 * dictionary's postings.
 */
export function docsSaying(index: SearchIndex, query: string): { readonly published: DocsSaying; readonly exported: DocsSaying } {
  const asked = tokensOf(query);
  const stems = asked.length < 2 ? [] : wordStemsNative(asked);
  const terms = stems.length === 0 ? [] : termsOfStems(index, stems);
  const writing = (
    postings: (term: number) => Uint32Array,
    doc: (row: number) => string | undefined,
    containing: readonly number[],
    openings: readonly number[],
  ): DocsSaying => {
    const rows = new Set(containing);
    const opening = new Set(openings);
    const written = phraseRows(stems, terms, postings, doc);
    for (const [row, first] of written) {
      rows.add(row);
      if (first) opening.add(row);
    }
    return { rows: written.size === 0 ? containing : [...rows].sort((a, b) => a - b), openings: opening };
  };
  return {
    published: writing(index.termPublished, (row) => index.published(row).doc, index.docsContaining(query), index.docOpeningsContaining(query)),
    exported: writing(index.termExported, (row) => index.exported(row).doc, index.exportedDocsContaining(query), index.exportedDocOpeningsContaining(query)),
  };
}

/** Per row whose doc writes `stems` in order, whether its opening paragraph does. */
function phraseRows(
  stems: readonly string[],
  terms: readonly (readonly number[])[],
  postings: (term: number) => Uint32Array,
  doc: (row: number) => string | undefined,
): ReadonlyMap<number, boolean> {
  const written = new Map<number, boolean>();
  if (stems.length === 0) return written;
  let held: Set<number> | undefined;
  for (const position of terms) {
    const rows = new Set<number>();
    for (const term of position) for (const row of postings(term)) if (held === undefined || held.has(row)) rows.add(row);
    if (rows.size === 0) return written;
    held = rows;
  }
  const candidates = [...(held ?? [])];
  const paragraphs = candidates.map((row) => (doc(row) ?? '').split(PARAGRAPH_BREAK).map(tokensOf));
  const reduced = wordStemsNative(paragraphs.flat(2));
  let at = 0;
  candidates.forEach((row, candidate) => {
    const writes = (paragraphs[candidate] ?? []).map((words) => holdsRun(reduced.slice(at, (at += words.length)), stems));
    if (writes.some(Boolean)) written.set(row, writes[0] === true);
  });
  return written;
}

/** Whether `words` hold `run` at consecutive places. */
function holdsRun(words: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= words.length; start += 1) {
    if (run.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}
