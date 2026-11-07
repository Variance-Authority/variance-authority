import { type NextRequest, NextResponse } from "next/server";
import { negotiation } from "./app/content/markdown-negotiation";

/**
 * Answers a page's address with its Markdown when the reader asks for that.
 *
 * This runs ahead of the edge cache, so the rewrite decides which cached entry
 * answers: the page and its Markdown keep the two addresses they are stored
 * under, and neither can be served for the other. `Vary` is added outside that
 * entry too, which matters: the CDN adapter refuses to store a tagged page that
 * varies on anything of its own, so a page must not declare this itself.
 */
export function proxy(request: NextRequest): NextResponse {
  const { address, varies } = negotiation(request.nextUrl.pathname, request.headers.get("accept"));
  const response = address ? NextResponse.rewrite(new URL(address, request.url)) : NextResponse.next();
  if (varies) response.headers.set("Vary", "Accept");
  return response;
}
