import MiniSearch from "minisearch";
import { searchCorpus } from "../content/search-corpus";
import { SEARCH_OPTIONS } from "../content/search-options";

export const revalidate = 3600;

/**
 * The search index, built from the same Markdown the pages render.
 *
 * What keeps the payload to term postings is that the prose each section was
 * indexed from stays behind: only what a result row shows is carried across.
 * The browser restores the index instead of re-deriving one, so the first
 * query costs a parse rather than a pass over every document on the site.
 */
export function GET(): Response {
  return new Response(serialized(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

let payload: string | undefined;

/**
 * The index, serialized once and kept for as long as this instance lives.
 *
 * The corpus is fixed at build time, so every reader is owed the same bytes
 * and only the first of them should pay for deriving them.
 */
function serialized(): string {
  if (payload === undefined) {
    const index = new MiniSearch(SEARCH_OPTIONS);
    index.addAll([...searchCorpus()]);
    payload = JSON.stringify(index);
  }

  return payload;
}
