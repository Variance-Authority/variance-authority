import { describe, expect, it } from "vitest";
import { LLMS_INDEX } from "../../content/llms-index";
import { SITE } from "../../metadata";
import { GET } from "./route";

describe("api-catalog", () => {
  it("answers one linkset entry that documents the site through its index", async () => {
    const response = GET();

    expect(response.headers.get("content-type")).toBe("application/linkset+json");
    expect(await response.json()).toEqual({
      linkset: [
        {
          anchor: `${SITE}/`,
          "service-doc": [{ href: `${SITE}${LLMS_INDEX}`, type: "text/markdown" }],
        },
      ],
    });
  });
});
