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

describe("the address a Markdown reader is sent to", () => {
  /** The route each rewritten address names, as the framework's file routes resolve it. */
  async function answered(path: string): Promise<Response> {
    const { rewrittenTo } = proxy(requested(path, "text/markdown")) as unknown as { rewrittenTo: string };
    const { pathname } = new URL(rewrittenTo);
    if (pathname === "/docs/index.md") return (await import("./(docs)/docs/index.md/route")).GET();
    const slug = /^\/docs\/([^/]+)\/index\.md$/.exec(pathname)?.[1];
    expect(slug, pathname).toBeDefined();
    const route = await import("./(docs)/docs/[slug]/index.md/route");
    return route.GET(new Request(rewrittenTo), { params: Promise.resolve({ slug: slug! }) });
  }

  it.each(["/docs", "/docs/tests"])("answers %s with its Markdown, typed text/markdown", async (path) => {
    const response = await answered(path);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(body).toMatch(/^# \S/m);
    expect(body).not.toMatch(/<html|<head|<body/i);
  });
});
