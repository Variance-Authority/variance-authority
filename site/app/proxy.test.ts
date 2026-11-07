import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { proxy } from "../proxy";

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
