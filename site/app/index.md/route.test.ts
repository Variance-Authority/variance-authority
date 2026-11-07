import { describe, expect, it } from "vitest";
import { GET as llms } from "../llms.txt/route";
import { GET } from "./route";

describe("the home's Markdown", () => {
  it("is the index, typed as Markdown", async () => {
    const response = await GET();

    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe(await llms().text());
  });
});
