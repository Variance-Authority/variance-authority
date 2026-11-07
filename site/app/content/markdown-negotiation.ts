import { LLMS_INDEX, MARKDOWN_TYPE } from "./llms-index";
import { markdownAddress } from "./routed-docs";

export interface Negotiation {
  readonly address: string | undefined;
  readonly varies: boolean;
}

/**
 * Which address answers a page's reader, and whether the answer depends on
 * `Accept`. A page with no Markdown stays its page and varies on nothing; the
 * home has no document, and the index is where a reader of Markdown starts.
 */
export function negotiation(path: string, accept: string | null): Negotiation {
  const address = path === "/" ? LLMS_INDEX : markdownAddress(path);
  return {
    address: address && prefersMarkdown(accept) ? address : undefined,
    varies: address !== undefined,
  };
}

/** A reader that names Markdown and does not weigh HTML above it. */
export function prefersMarkdown(accept: string | null): boolean {
  const weights = new Map((accept ?? "").split(",").map(weighed));
  const markdown = weights.get(MARKDOWN_TYPE) ?? 0;
  const html = weights.get("text/html") ?? weights.get("text/*") ?? weights.get("*/*") ?? 0;
  return markdown > 0 && markdown >= html;
}

function weighed(range: string): [string, number] {
  const [type = "", ...parameters] = range.split(";");
  const quality = parameters.map((parameter) => /^\s*q=([\d.]+)/i.exec(parameter)?.[1]).find(Boolean);
  return [type.trim().toLowerCase(), quality === undefined ? 1 : Number(quality)];
}
