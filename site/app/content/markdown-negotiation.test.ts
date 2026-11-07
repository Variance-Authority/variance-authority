import { describe, expect, it } from "vitest";
import { LLMS_INDEX } from "./llms-index";
import { negotiation, prefersMarkdown } from "./markdown-negotiation";

describe("negotiation", () => {
  it("answers a page with Markdown from that Markdown, and says it varies", () => {
    expect(negotiation("/docs", "text/markdown")).toEqual({ address: "/docs/index.md", varies: true });
    expect(negotiation("/reference/comparison", "text/markdown").address).toBe(
      "/reference/comparison/index.md",
    );
  });

  it("leaves that page to a browser, and still says it varies", () => {
    expect(negotiation("/docs", "text/html,*/*;q=0.8")).toEqual({ address: undefined, varies: true });
  });

  it("answers the home from the index", () => {
    expect(negotiation("/", "text/markdown")).toEqual({ address: LLMS_INDEX, varies: true });
  });

  it.each(["/docs/all", "/docs/theory", "/docs/index.md", "/llms.txt", "/docs/start", "/docs/comparison"])(
    "leaves %s, which has no Markdown of its own, to its page",
    (path) => {
      expect(negotiation(path, "text/markdown")).toEqual({ address: undefined, varies: false });
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
    "text/markdown;q=0.5, */*;q=0.9",
    "text/markdown;q=0.5, text/*;q=0.9",
  ])("takes %s as a reader of the page", (accept) => {
    expect(prefersMarkdown(accept)).toBe(false);
  });
});
