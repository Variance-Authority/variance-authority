import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../content/examples";
import { GET } from "./route";

/**
 * `llms.txt` is where an agent lands from any README, so it answers the first
 * questions an agent has before it lists the catalogue: how to install, how to
 * get the shipped skills into its own skills directory, which integration fits,
 * and a repository it can clone and run.
 */
describe("llms.txt", () => {
  const text = GET().text();

  it("opens with where to start, before the catalogue", async () => {
    const index = await text;
    const start = index.indexOf("## Start here");
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(index.indexOf("## Documentation"));
    expect(index).toContain("npm install --save-dev @variance-authority/cli");
    expect(index).toContain("/agents/cli/index.md#point-an-agent-at-it");
    expect(index).toContain("/start/index.md");
  });

  it("links every example repository", async () => {
    const index = await text;
    expect(index).toContain("## Examples");
    for (const { repository } of EXAMPLES) {
      expect(index).toContain(`https://github.com/Variance-Authority/${repository}`);
    }
  });
});
