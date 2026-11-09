import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { GET as documentMarkdown } from "./(docs)/docs/[slug]/index.md/route";
import { GET as docsMarkdown } from "./(docs)/docs/index.md/route";
import { markdownAddress } from "./content/routed-docs";

vi.mock("next/server", () => ({
  NextResponse: {
    next: () => ({ headers: new Headers() }),
    rewrite: (url: URL) => ({ rewrittenTo: url.href, headers: new Headers() }),
  },
}));

function requested(path: string, accept: string): NextRequest {
  const url = new URL(path, "https://variance-authority.dev");
  return { url: url.href, nextUrl: url, headers: new Headers({ accept }) } as unknown as NextRequest;
}

describe("the proxy", () => {
  it("answers a Markdown reader from the page's Markdown, and says the page varies", () => {
    const response = proxy(requested("/docs", "text/markdown"));

    expect(response).toMatchObject({ rewrittenTo: "https://variance-authority.dev/docs/index.md" });
    expect(response.headers.get("vary")).toBe("Accept");
  });

  it("leaves a browser on the page, and still says the page varies", () => {
    const response = proxy(requested("/docs", "text/html"));

    expect(response).not.toHaveProperty("rewrittenTo");
    expect(response.headers.get("vary")).toBe("Accept");
  });

  it("leaves a page with no Markdown alone", () => {
    const response = proxy(requested("/docs/all", "text/markdown"));

    expect(response).not.toHaveProperty("rewrittenTo");
    expect(response.headers.get("vary")).toBeNull();
  });
});

describe("the address a Markdown reader is sent to", () => {
  it.each(["/docs", "/docs/tests"])("is the Markdown address the site names for %s", (path) => {
    const response = proxy(requested(path, "text/markdown"));

    expect(response).toMatchObject({ rewrittenTo: new URL(markdownAddress(path)!, "https://variance-authority.dev").href });
  });

  it.each([
    ["/docs/index.md", () => docsMarkdown()],
    ["/docs/tests/index.md", () => documentMarkdown(new Request("https://variance-authority.dev/docs/tests/index.md"), { params: Promise.resolve({ slug: "tests" }) })],
  ])("%s answers with Markdown, typed text/markdown", async (_address, get) => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toMatch(/^# \S/m);
    expect(body).not.toMatch(/<html|<head|<body/i);
  });
});
