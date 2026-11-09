import { describe, expect, it } from "vitest";
import { GET as documentMarkdown } from "../(docs)/docs/[slug]/index.md/route";
import { GET as docsMarkdown } from "../(docs)/docs/index.md/route";

/**
 * The proxy sends a reader that asks for Markdown to a page's `index.md`
 * address; these are the answers those addresses give, a fixed page and a
 * generated one. That the framework routes the rewrite here is its own to prove.
 */
describe("a page's Markdown address", () => {
  it.each([
    ["/docs/index.md", () => docsMarkdown()],
    [
      "/docs/tests/index.md",
      () =>
        documentMarkdown(new Request("https://variance-authority.dev/docs/tests/index.md"), {
          params: Promise.resolve({ slug: "tests" }),
        }),
    ],
  ])("%s answers with Markdown, typed text/markdown", async (_address, get) => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toMatch(/^# \S/m);
    expect(body).not.toMatch(/<html|<head|<body/i);
  });
});
