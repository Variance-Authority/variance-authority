import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightRenderer } from "@variance-authority/playwright/renderer";
import type { Raster } from "@variance-authority/core/format";
import {
  routeCollector,
  type Collected,
  type Collector,
  type Plan,
} from "./index.js";

/**
 * An image a page made from bytes it held, read by the collector every page
 * agent shares.
 *
 * A page that computes an image — a canvas encoded to a blob, a file the user
 * dropped, a response read as a blob — shows it through an object URL:
 * `blob:<origin>/<uuid>`. That URL names memory in the page that minted it.
 * The deferred renderer paints the document in a page of its own, where the
 * URL names nothing, so a document that carried it painted a broken image; and
 * the uuid is new on every load, so the same picture acquired twice was two
 * documents.
 *
 * Every page below holds the same six-by-four red PNG. One writes it into its
 * markup as a `data:` URL; the others hand it to the image as an object URL
 * from script, the way a page that computed it would. A page with no image
 * bytes at all is the control: a renderer that painted every image broken
 * would paint the first two alike and fail it.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    "\npackages/route-collector (object URLs): skipped." +
      "\n  no browser — npx playwright install chromium\n",
  );
}

const SQUARE =
  "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAYAAACtBE5DAAAAEklEQVR4nGN4YGD1HxtmoJ4EALJWNtlGQg5BAAAAAElFTkSuQmCC";

const image = (src = ""): string =>
  `<main id="app"><img alt="square" width="60" height="40"${src}></main>`;

/** The square, handed to the image through an object URL made from its bytes. */
function held(after = "", assign = "img.src = url;"): string {
  return `<!doctype html><html><body>${image()}<script>
      const bytes = Uint8Array.from(atob('${SQUARE}'), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const img = document.querySelector('img');
      ${after}
      ${assign}
    </script></body></html>`;
}

const PAGES: Readonly<Record<string, string>> = {
  "/none": `<!doctype html><html><body>${image()}</body></html>`,
  "/inline": `<!doctype html><html><body>${image(
    ` src="data:image/png;base64,${SQUARE}"`,
  )}</body></html>`,
  "/held": held(),
  "/candidate": held("", "img.srcset = url + ' 1x';"),
  // Shown, and then let go: the page still paints the square, and nothing can
  // read its bytes any more.
  "/revoked": held(
    `img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });`,
  ),
};

/** Two subjects on `/held`, the second with a query so the page is loaded again. */
const ROUTES: Readonly<Record<string, string>> = {
  "object/none": "/none",
  "object/inline": "/inline",
  "object/held": "/held",
  "object/held-again": "/held?again",
  "object/candidate": "/candidate",
  "object/revoked": "/revoked",
};

const PLAN: Plan = {
  subjects: Object.keys(ROUTES).map((id) => ({
    subject: { id, kind: "route" as const },
  })),
  notObserved: [],
  warnings: [],
};

let server: Server | undefined;
let collector: Collector | undefined;
let renderer: Awaited<ReturnType<typeof createPlaywrightRenderer>> | undefined;
const read = new Map<string, Extract<Collected, { ok: true }>>();
const painted = new Map<string, Raster>();

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const body = PAGES[(request.url ?? "/").split("?")[0] ?? "/"];
    if (body === undefined) {
      response.writeHead(404).end("not found");
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(body);
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(
        address === null || typeof address === "string" ? 0 : address.port,
      );
    });
  });
  const base = `http://127.0.0.1:${port}`;

  collector = await routeCollector({
    routes: Object.fromEntries(
      Object.entries(ROUTES).map(([id, path]) => [id, `${base}${path}`]),
    ),
    roots: ["#app"],
  })({
    config: {
      viewport: {
        width: 200,
        height: 100,
        deviceScaleFactor: 1,
        colorScheme: "light",
      },
    },
    plan: PLAN,
  });
  renderer = await createPlaywrightRenderer();

  for (const planned of PLAN.subjects) {
    const collected = await collector.collect(planned);
    if (!collected.ok)
      throw new Error(`${planned.subject.id} was not collected`);
    read.set(planned.subject.id, collected);
    painted.set(planned.subject.id, await renderer.render(collected.document));
  }
}, 120_000);

afterAll(async () => {
  await collector?.close();
  await renderer?.close();
  server?.closeAllConnections();
  if (server !== undefined)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

function html(id: string): string | undefined {
  return read.get(`object/${id}`)?.document.html;
}

function bytes(id: string): string | undefined {
  return painted.get(`object/${id}`)?.bytes;
}

chromium_("an image a page made from bytes it held", () => {
  it("paints a square written into the markup, so the comparison below can fail", () => {
    expect(bytes("inline")).toBeDefined();
    expect(bytes("inline")).not.toBe(bytes("none"));
  });

  it("paints the square it showed through an object URL", () => {
    expect(bytes("held")).toBe(bytes("inline"));
  });

  it("carries the square's bytes in the document, where the URL named memory in the page", () => {
    expect(html("held")).not.toContain("blob:");
    expect(html("held")).toBe(html("inline"));
  });

  it("acquires the same document from the same page on two loads", () => {
    expect(html("held-again")).toBeDefined();
    expect(html("held-again")).toBe(html("held"));
  });

  it("carries a srcset candidate's bytes, and the density it was offered at", () => {
    expect(html("candidate")).not.toContain("blob:");
    expect(html("candidate")).toContain(`srcset="data:image/png;base64,${SQUARE} 1x"`);
    expect(bytes("candidate")).toBe(bytes("inline"));
  });

  it("fails a subject whose object URL no longer reads, rather than painting it broken", () => {
    const diagnostics = read.get("object/revoked")?.document.diagnostics ?? [];
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "unreadable-object-url",
      }),
    );
  });
});
