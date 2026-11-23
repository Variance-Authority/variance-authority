import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const KEPT =
  "https://raw.githubusercontent.com/Variance-Authority/variance-authority/refs/coverage/main/coverage.html";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/coverage", () => {
  it("answers the page kept at refs/coverage/main as HTML that may run its own inline style and script, fetch nothing, and reach nothing of the site's origin", async () => {
    const fetched = vi.fn(async () => new Response("<!doctype html><p>coverage</p>"));
    vi.stubGlobal("fetch", fetched);

    const response = await GET();

    expect(fetched).toHaveBeenCalledWith(KEPT);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<!doctype html><p>coverage</p>");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox allow-scripts",
    );
  });

  it("answers 503, held by nothing, and says why when the ref cannot be read", async () => {
    vi.stubGlobal("fetch", async () => new Response("404: Not Found", { status: 404 }));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(
      "The coverage page could not be read from refs/coverage/main (404). The next push to main keeps a new one.\n",
    );
  });

  it("answers 503 the same way when GitHub cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      "The coverage page could not be read from refs/coverage/main (fetch failed). The next push to main keeps a new one.\n",
    );
  });

  it("answers 503 the same way when the page breaks off while it is read", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    vi.stubGlobal("fetch", async () => new Response(broken));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      "The coverage page could not be read from refs/coverage/main (terminated). The next push to main keeps a new one.\n",
    );
  });
});
