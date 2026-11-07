import { type NextRequest, NextResponse } from "next/server";
import { MARKDOWN_TYPE } from "./llms-index";
import { markdownPath, routedDocument } from "./routed-docs";

/**
 * Answers a page's address with its Markdown when the reader asks for that.
 *
 * This runs ahead of the edge cache, so the rewrite decides which cached entry
 * answers: the page and its Markdown keep the two addresses they are stored
 * under, and neither can be served for the other. `Vary` is added outside that
 * entry too, which matters: the CDN adapter refuses to store a tagged page that
 * varies on anything of its own, so a page must not declare this itself.
 */
export function negotiated(request: NextRequest): NextResponse {
  const address = markdownAddress(request.nextUrl.pathname);
  if (!address) return NextResponse.next();

  const response = prefersMarkdown(request.headers.get("accept"))
    ? NextResponse.rewrite(new URL(address, request.url))
    : NextResponse.next();
  response.headers.set("Vary", "Accept");
  return response;
}

/**
 * The Markdown a page's address can answer with, for a reader that asks for it
 * by `Accept`. A page with no Markdown has none, and stays its page: the
 * question is asked of the document, so an address that merely looks like an
 * article's never reaches a Markdown route that would answer 404.
 */
export function markdownAddress(path: string): string | undefined {
  if (path === "/") return "/index.md";
  return routedDocument(path) ? markdownPath(path) : undefined;
}

/** A reader that names Markdown and does not weigh HTML above it. */
export function prefersMarkdown(accept: string | null): boolean {
  const weights = new Map((accept ?? "").split(",").map(weighed));
  const markdown = weights.get(MARKDOWN_TYPE) ?? 0;
  return markdown > 0 && markdown >= (weights.get("text/html") ?? 0);
}

function weighed(range: string): [string, number] {
  const [type = "", ...parameters] = range.split(";");
  const quality = parameters.map((parameter) => /^\s*q=([\d.]+)/i.exec(parameter)?.[1]).find(Boolean);
  return [type.trim().toLowerCase(), quality === undefined ? 1 : Number(quality)];
}
