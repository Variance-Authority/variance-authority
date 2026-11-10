import { type NextRequest, NextResponse } from "next/server";
import { negotiation } from "./app/content/markdown-negotiation";

/**
 * Answers a page's address with its Markdown when the reader asks for that.
 *
 * This runs in the uncached gateway, ahead of any stored page, so a stored page
 * cannot answer a rewritten reader. On `wrangler dev` the Markdown a rewrite
 * reaches comes back `no-store`: it is rendered per request. `Vary` is added
 * here, outside the page, because the CDN adapter refuses to store a tagged page
 * that varies on anything of its own. On the production edge, alternating readers
 * in either order each got their own answer, and the HTML came from the cache.
 */
export function proxy(request: NextRequest): NextResponse {
  const { address, varies } = negotiation(request.nextUrl.pathname, request.headers.get("accept"));
  const response = address ? NextResponse.rewrite(new URL(address, request.url)) : NextResponse.next();
  if (varies) response.headers.set("Vary", "Accept");
  return response;
}
