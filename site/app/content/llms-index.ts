/**
 * Where a reader that takes Markdown starts, and how each response says so.
 *
 * The index is announced three ways because readers arrive three ways: a page
 * carries it in the head, a response carries it in a header for anything that
 * never parses HTML, and `robots.txt` carries it for a crawler that reads that
 * file before it reads anything else.
 */
export const LLMS_INDEX = "/llms.txt";

export const MARKDOWN_TYPE = "text/markdown";

/** `Link:` header pointing at the index, for responses that are not pages. */
export const LLMS_LINK = `<${LLMS_INDEX}>; rel="describedby"; type="${MARKDOWN_TYPE}"`;
