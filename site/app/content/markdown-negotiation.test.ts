import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { markdownAddress, negotiated, prefersMarkdown } from "./markdown-negotiation";

vi.mock("next/server", () => ({
  NextResponse: {
    next: () => new Response(null),
    rewrite: (url: URL) => new Response(null, { headers: { "x-rewrite": url.pathname } }),
  },
}));

function request(path: string, accept: string): NextRequest {
  const url = `https://variance-authority.dev${path}`;
  return {
    headers: new Headers({ accept }),
    nextUrl: new URL(url),
    url,
  } as unknown as NextRequest;
}

describe("negotiated", () => {
  it("answers a page with Markdown from that Markdown, and says it varies", () => {
    const { headers } = negotiated(request("/docs", "text/markdown"));

    expect(headers.get("x-rewrite")).toBe("/docs/index.md");
    expect(headers.get("vary")).toBe("Accept");
  });

  it("leaves that page to a browser, and still says it varies", () => {
    const { headers } = negotiated(request("/docs", "text/html,*/*;q=0.8"));

    expect(headers.get("x-rewrite")).toBeNull();
    expect(headers.get("vary")).toBe("Accept");
  });

  it("leaves a page with no Markdown alone under the same header", () => {
    const { headers } = negotiated(request("/docs/all", "text/markdown"));

    expect(headers.get("x-rewrite")).toBeNull();
    expect(headers.get("vary")).toBeNull();
  });
});

describe("markdownAddress", () => {
  it("names the Markdown beside a page that has it", () => {
    expect(markdownAddress("/docs")).toBe("/docs/index.md");
    expect(markdownAddress("/reference/comparison")).toBe("/reference/comparison/index.md");
  });

  it("answers the home from its own Markdown", () => {
    expect(markdownAddress("/")).toBe("/index.md");
  });

  it.each(["/docs/all", "/docs/theory", "/docs/index.md", "/llms.txt"])(
    "leaves %s, which has no Markdown of its own, to its page",
    (path) => {
      expect(markdownAddress(path)).toBeUndefined();
    },
  );
});

describe("prefersMarkdown", () => {
  it.each([
    "text/markdown",
    "TEXT/Markdown; charset=utf-8",
    "text/markdown, text/html, */*",
    "text/html;q=0.8, text/markdown;q=0.9",
  ])("takes %s as a reader of Markdown", (accept) => {
    expect(prefersMarkdown(accept)).toBe(true);
  });

  it.each([
    null,
    "*/*",
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "text/html, text/markdown;q=0.5",
    "text/markdown;q=0",
  ])("takes %s as a reader of the page", (accept) => {
    expect(prefersMarkdown(accept)).toBe(false);
  });
});
