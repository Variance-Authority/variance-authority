import { describe, expect, it } from "vitest";
import { EXAMPLES, exampleUrl } from "../content/examples";
import { documentHeadings } from "../content/markdown-text";
import { routedDocument } from "../content/routed-docs";
import { GITHUB } from "../links";
import { SITE } from "../metadata";
import { GET } from "./route";

/**
 * `llms.txt` is where an agent lands from any README, so it answers the first
 * questions an agent has before it lists the catalogue: how to install, how to
 * get the shipped skills into its own skills directory, which integration fits,
 * and a repository it can clone and run.
 */
describe("llms.txt", () => {
  const text = GET().text();

  /** The block between `## Start here` and the next heading. */
  async function start(): Promise<string> {
    const index = await text;
    const from = index.indexOf("## Start here");
    expect(from).toBeGreaterThan(-1);
    return index.slice(from, index.indexOf("\n## ", from + 1));
  }

  it("opens with where to start, before the catalogue", async () => {
    const index = await text;
    expect(index.indexOf("## Start here")).toBeLessThan(index.indexOf("## Documentation"));
    const block = await start();
    expect(block).toContain("npm install --save-dev @variance-authority/cli");
    expect(block).toContain("/agents/cli/index.md#point-an-agent-at-it");
    expect(block).toContain("/agents/index.md");
    expect(block).toContain("/start/index.md");
    expect(block).toContain(`(${GITHUB})`);
  });

  it("links every example repository", async () => {
    const index = await text;
    expect(index).toContain("## Examples");
    for (const example of EXAMPLES) expect(index).toContain(`(${exampleUrl(example)})`);
  });

  it("anchors only headings the page renders", async () => {
    const site = new URL(SITE).origin;
    const anchored = [...(await text).matchAll(/\]\(([^)\s]+#[^)\s]+)\)/g)].map(([, link]) => link!);
    expect(anchored.length).toBeGreaterThan(0);
    for (const link of anchored) {
      const { origin, pathname, hash } = new URL(link);
      expect(origin).toBe(site);
      const document = routedDocument(pathname.replace(/\/index\.md$/, ""));
      expect(document, link).toBeDefined();
      expect(documentHeadings(document!.source).map(({ id }) => id), link).toContain(hash.slice(1));
    }
  });
});
