/**
 * The terms of the search index, held where both ends can read them.
 *
 * The index is built during the build and read back in the browser, and
 * MiniSearch only restores a serialized index under the options it was written
 * with — a field list that has drifted, or a `processTerm` that now keeps a word
 * it used to drop, and the load throws. One module answers for both so the two
 * ends cannot disagree.
 */

import type { Options, SearchOptions } from "minisearch";

/** One `##` section of one published document: what a result points at. */
export interface SearchEntry {
  /** `path#hash`, unique across the site. */
  readonly id: string;
  /** The published page the section is on. */
  readonly path: string;
  /** The section's anchor, empty for a document's opening. */
  readonly hash: string;
  /** The document's own title. */
  readonly title: string;
  /** The section heading, empty for a document's opening. */
  readonly heading: string;
  /** The navigation section the page reads under. */
  readonly section: string;
  /**
   * How the navigation names the page, carried by its opening entry only.
   *
   * A page is listed under a question — *trace instability to its owner* — and
   * that is the wording a reader arrives with, whether or not the document
   * repeats it. Holding it on the opening entry alone means matching it lands
   * on the page rather than on whichever of its sections scored highest.
   */
  readonly label: string;
  /** The first prose paragraph, shown under the result. */
  readonly lead: string;
  /** Everything the section says, including its code. Matched, never shown. */
  readonly text: string;
}

/** Where the built index is served. */
export const SEARCH_INDEX_PATH = "/search-index.json";

/**
 * Words carried by nearly every section, which cost postings and decide
 * nothing. Dropping them is worth about a fifth of the index.
 */
const COMMON = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "for", "from",
  "has", "have", "in", "is", "it", "its", "not", "of", "on", "or", "that",
  "the", "them", "then", "they", "this", "to", "was", "were", "what", "when",
  "which", "with", "you", "your",
]);

export const SEARCH_OPTIONS: Options<SearchEntry> = {
  fields: ["title", "label", "heading", "lead", "text"],
  storeFields: ["path", "hash", "title", "heading", "section", "lead"],
  processTerm: (term) => {
    const lowered = term.toLowerCase();
    return lowered.length < 2 || COMMON.has(lowered) ? null : lowered;
  },
};

/**
 * How a reader's typing is matched.
 *
 * Every term has to land somewhere, or a two-word query returns everything
 * either word touches. Every term is also a prefix: the last one is still being
 * typed, and the ones before it are usually the short form of a longer word on
 * the page — *flake* is how a reader asks for flakiness. Exact matches still
 * rank above the prefixes they share a stem with.
 *
 * Where a page and one of its sections both answer, the page goes first. A
 * reader who typed the name of a subject wants the document about it, not
 * whichever paragraph inside it happened to weigh the term heaviest.
 */
export const SEARCH_QUERY: SearchOptions = {
  boost: { title: 4, label: 4, heading: 3, lead: 1.5 },
  boostDocument: (_id, _term, stored) => (stored?.hash ? 1 : 1.5),
  combineWith: "AND",
  fuzzy: 0.2,
  prefix: true,
};
