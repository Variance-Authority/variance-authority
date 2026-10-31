import { describedWordsNative, phraseOfNative } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { termsOfStems } from './loose.js';

// compass: variance-authority.report.agent-surface

/** The rows of one kind whose doc says a question, ascending, and those of them that say it in their opening paragraph. */
export interface DocsSaying {
  readonly rows: readonly number[];
  readonly openings: ReadonlySet<number>;
}

/**
 * The published and exported rows whose doc says `query`: holds it as typed,
 * case aside, or writes its words as a phrase, by the rule the sense addon
 * reads a doc's nearness by ({@link phraseOfNative}). So "the page's sink"
 * writes `page sink`, and "the sink of a page" and "a page and its sink" do not.
 *
 * A question of fewer than two distinct stems is no phrase. Otherwise only a doc
 * holding a term of every stem is decoded, read off the dictionary's postings
 * by the stems the described section asks by.
 */
export function docsSaying(index: SearchIndex, query: string): { readonly published: DocsSaying; readonly exported: DocsSaying } {
  const stems = describedWordsNative(query).map(([stem]) => stem);
  const terms = stems.length < 2 ? [] : termsOfStems(index, stems);
  const writing = (
    postings: (term: number) => Uint32Array,
    doc: (row: number) => string | undefined,
    containing: readonly number[],
    openings: readonly number[],
  ): DocsSaying => {
    const rows = new Set(containing);
    const opening = new Set(openings);
    const written = phraseRows(query, terms, postings, doc);
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

/** Per row whose doc writes `query` as a phrase, whether its opening paragraph does. */
function phraseRows(
  query: string,
  terms: readonly (readonly number[])[],
  postings: (term: number) => Uint32Array,
  doc: (row: number) => string | undefined,
): ReadonlyMap<number, boolean> {
  const written = new Map<number, boolean>();
  if (terms.length === 0) return written;
  let held: Set<number> | undefined;
  for (const position of terms) {
    const rows = new Set<number>();
    for (const term of position) for (const row of postings(term)) if (held === undefined || held.has(row)) rows.add(row);
    if (rows.size === 0) return written;
    held = rows;
  }
  const candidates = [...(held ?? [])];
  const paragraphs = phraseOfNative(query, candidates.map((row) => doc(row) ?? ''));
  candidates.forEach((row, at) => {
    const paragraph = paragraphs[at];
    if (paragraph !== undefined) written.set(row, paragraph === 0);
  });
  return written;
}
