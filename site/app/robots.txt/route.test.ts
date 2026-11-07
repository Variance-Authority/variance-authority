import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("robots.txt", () => {
  it("declares what the site's content may be used for, inside the rule block", async () => {
    const lines = (await GET().text()).split("\n");

    expect(lines).toEqual([
      "User-agent: *",
      "Content-Signal: ai-train=yes, search=yes, ai-input=yes",
      "Allow: /",
      "",
      "Sitemap: https://variance-authority.dev/sitemap.xml",
      "",
    ]);
  });
});
