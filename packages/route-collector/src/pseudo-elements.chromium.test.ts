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
 * A badge whose words and colour live in `::before`.
 *
 * The allowlist leaves `content` out because the text a `::before` says is
 * captured as text, on a child of the badge. A pseudo-element is not an element:
 * nothing walking `childNodes` reaches it, `Element.matches` answers `false` for a
 * selector ending in one, and `getComputedStyle(element)` describes the element
 * itself. So the claim is checked here on the engine the chromium profile reads,
 * by changing only the pseudo-element and asking whether either product of the
 * one read moves: the image the renderer paints from the document, and the
 * snapshot the comparison runs on.
 *
 * The badge's box is sized by its own rule, so a change to the words inside it
 * cannot move its geometry: what is under test is whether the text and paint of
 * `::before` are read, not whether a layout shift they cause is. The live page is
 * photographed too, because a change no screen shows would make a still snapshot
 * correct; and the control changes the badge's own background, so a pipeline
 * that never moved would fail it.
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
    "\npackages/route-collector (pseudo-elements): skipped." +
      "\n  no browser — npx playwright install chromium\n",
  );
}

function badge(own: string, before: string): string {
  return `<!doctype html><html><head><style>
      .badge { display: inline-block; width: 96px; height: 24px; ${own} }
      .badge::before { ${before} }
    </style></head><body><main id="app"><span class="badge"></span></main></body></html>`;
}

const OWN = "background-color: rgb(255, 255, 255);";
const BEFORE = 'content: "New"; color: rgb(0, 0, 255);';

const PAGES: Readonly<Record<string, string>> = {
  "/plain": badge(OWN, BEFORE),
  "/recoloured": badge(OWN, 'content: "New"; color: rgb(255, 0, 0);'),
  "/reworded": badge(OWN, 'content: "Old"; color: rgb(0, 0, 255);'),
  "/own-background": badge("background-color: rgb(255, 255, 0);", BEFORE),
};

const PLAN: Plan = {
  subjects: Object.keys(PAGES).map((path) => ({
    subject: { id: `badge${path}`, kind: "route" as const },
  })),
  notObserved: [],
  warnings: [],
};

let server: Server | undefined;
let collector: Collector | undefined;
let renderer: Awaited<ReturnType<typeof createPlaywrightRenderer>> | undefined;
const read = new Map<string, Extract<Collected, { ok: true }>>();
const painted = new Map<string, Raster>();
const seen = new Map<string, string>();

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
      Object.keys(PAGES).map((path) => [`badge${path}`, `${base}${path}`]),
    ),
    roots: ["#app"],
  })({
    config: {
      viewport: {
        width: 400,
        height: 200,
        deviceScaleFactor: 1,
        colorScheme: "light",
      },
    },
    plan: PLAN,
  });
  renderer = await createPlaywrightRenderer();

  // The live page, photographed by Playwright alone: what a person sees.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 400, height: 200 },
    });
    for (const path of Object.keys(PAGES)) {
      await page.goto(`${base}${path}`);
      seen.set(
        `badge${path}`,
        (await page.locator("#app").screenshot()).toString("base64"),
      );
    }
  } finally {
    await browser.close();
  }

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

function image(id: string): string | undefined {
  return painted.get(`badge/${id}`)?.bytes;
}

function renderHash(id: string): string | undefined {
  return read.get(`badge/${id}`)?.snapshot?.renderHash;
}

function live(id: string): string | undefined {
  return seen.get(`badge/${id}`);
}

chromium_("a change made only to `::before`, on the live page", () => {
  it("shows the badge's own background, and each change below", () => {
    expect(live("plain")).toBeDefined();
    expect(live("own-background")).not.toBe(live("plain"));
    expect(live("recoloured")).not.toBe(live("plain"));
    expect(live("reworded")).not.toBe(live("plain"));
  });
});

chromium_(
  "a change made only to `::before`, painted from its render document",
  () => {
    it("paints the badge's own background, so the comparisons below can fail", () => {
      expect(image("own-background")).toBeDefined();
      expect(image("own-background")).not.toBe(image("plain"));
    });

    it("paints a change to the colour of `::before`", () => {
      expect(image("recoloured")).not.toBe(image("plain"));
    });

    it("paints a change to the text of `::before`", () => {
      expect(image("reworded")).not.toBe(image("plain"));
    });
  },
);

chromium_(
  "a change made only to `::before`, compared through its snapshot",
  () => {
    it("moves the snapshot for the badge's own background, so the comparisons below can fail", () => {
      expect(renderHash("own-background")).toBeDefined();
      expect(renderHash("own-background")).not.toBe(renderHash("plain"));
    });

    it("moves the snapshot when the colour of `::before` changes", () => {
      expect(renderHash("recoloured")).not.toBe(renderHash("plain"));
    });

    it("moves the snapshot when the text of `::before` changes", () => {
      expect(renderHash("reworded")).not.toBe(renderHash("plain"));
    });

    it("reads `::before` as the badge's first child, saying its words as text", () => {
      const badge = read.get("badge/plain")?.snapshot?.root.children[0];
      const box = badge?.children[0];
      expect(box?.tag).toBe("::before");
      expect(box?.style["color"]).toBe("rgb(0 0 255 / 1)");
      expect(box?.children.map((child) => child.text)).toEqual(["New"]);
    });
  },
);
