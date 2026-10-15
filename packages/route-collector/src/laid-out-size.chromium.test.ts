import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightRenderer } from "@variance-authority/playwright/renderer";
import type { Raster } from "@variance-authority/core/format";
import { routeCollector, type Collected, type Plan } from "./index.js";

/**
 * A subject painted from its render document is the size the live page laid it
 * out at.
 *
 * Each page here is styled the way Tailwind v4 styles the site, by a rule the
 * capture once lost, and lost a different way. The site's home page painted
 * 1,486 px short of its live height, and its reference pages up to 7% tall.
 * Each subject is measured live and painted from the document its one read
 * produced, and the two must agree.
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
    "\npackages/route-collector (laid-out size): skipped." +
      "\n  no browser — npx playwright install chromium\n",
  );
}

/**
 * Shorthands holding a `var()`, as `py-4`, `px-5` and `mx-auto` are written.
 * Chromium enumerates one as its longhands with empty values, pending
 * substitution, and answers `getPropertyValue` only for the shorthand declared.
 */
const SHORTHANDS: Readonly<Record<string, string>> = {
  "padding-block": "calc(var(--spacing) * 4)",
  "padding-inline": "var(--spacing)",
  "margin-block": "var(--spacing) calc(var(--spacing) * 2)",
  "border-inline": "var(--spacing) solid rgb(0, 0, 0)",
};

function page(css: string, body: string): string {
  return `<!doctype html><html><head><style>
      body { margin: 0; }
      #app { display: flow-root; }
      ${css}
    </style></head><body><main id="app">${body}</main></body></html>`;
}

const PAGES: Readonly<Record<string, string>> = {
  "/shorthands": page(
    `:root { --spacing: 4px; }
     .box { display: block; width: 120px; height: 20px;
       ${Object.entries(SHORTHANDS)
         .map(([property, value]) => `${property}: ${value};`)
         .join(" ")} }`,
    '<div class="box"></div>',
  ),
  // A line height declared as a number on the root, as Tailwind's preflight
  // declares it, and a font size set below it as `text-[10px]` sets one: the
  // line is 1.5 × 10px. The root's computed line height is 24px, and a page
  // that inherited that instead lays the line out at 24.
  "/relative-line-height": page(
    "html { line-height: 1.5; font-size: 16px; } .small { margin: 0; font-size: 10px; }",
    '<p class="small">One line</p>',
  ),
  // Tailwind's preflight and utilities sit in cascade layers, and the site's
  // prose rules sit outside them at no specificity: `h2 { font-size: inherit }`
  // in `base` loses to `:where(.doc h2)` only because a layered rule loses to
  // an unlayered one. The heading is 40px at the root's 1.5, the line below it
  // 1.5 × 10px.
  "/layers": page(
    `@layer base, components;
     @layer base { html { line-height: 1.5; font-size: 16px; } h2 { font-size: inherit; margin: 0; } }
     @layer components { @layer cards { .doc { display: block; } } }
     :where(.doc h2) { font-size: 40px; }
     .small { margin: 0; font-size: 10px; }`,
    '<div class="doc"><h2>Title</h2><p class="small">One line</p></div>',
  ),
  // The body's padding set in a layer, as a Tailwind page sets it with a class
  // on `<body>`. The render's own reset of the page margin must lose to it, as
  // the browser's default margin does: the subject is 40px narrower than the
  // viewport.
  "/layered-body": page(
    `@layer base { body { padding-inline: 20px; } }
     .box { display: block; height: 20px; }`,
    '<div class="box"></div>',
  ),
};

const PLAN: Plan = {
  subjects: Object.keys(PAGES).map((path) => ({
    subject: { id: path.slice(1), kind: "route" as const },
  })),
  notObserved: [],
  warnings: [],
};

let server: Server | undefined;
const read = new Map<string, Extract<Collected, { ok: true }>>();
const painted = new Map<string, Raster>();
const live = new Map<string, { width: number; height: number }>();

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const body = PAGES[(request.url ?? "/").split("?")[0] ?? "/"];
    if (body === undefined) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  const port = await new Promise<number>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(address === null || typeof address === "string" ? 0 : address.port);
    });
  });
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width: 400, height: 200 } });
    for (const path of Object.keys(PAGES)) {
      await tab.goto(`${base}${path}`);
      const box = await tab.locator("#app").boundingBox();
      if (box !== null) live.set(path.slice(1), box);
    }
  } finally {
    await browser.close();
  }

  const collector = await routeCollector({
    routes: Object.fromEntries(Object.keys(PAGES).map((path) => [path.slice(1), `${base}${path}`])),
    roots: ["#app"],
  })({
    config: {
      viewport: { width: 400, height: 200, deviceScaleFactor: 1, colorScheme: "light" },
    },
    plan: PLAN,
  });
  const renderer = await createPlaywrightRenderer();
  try {
    for (const planned of PLAN.subjects) {
      const result = await collector.collect(planned);
      if (!result.ok) throw new Error(`${planned.subject.id} was not collected`);
      read.set(planned.subject.id, result);
      painted.set(planned.subject.id, await renderer.render(result.document));
    }
  } finally {
    await collector.close();
    await renderer.close();
  }
}, 120_000);

afterAll(async () => {
  server?.closeAllConnections();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

function size(id: string): { width?: number; height?: number } {
  const raster = painted.get(id);
  return { width: raster?.width, height: raster?.height };
}

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

function paintsAsLaidOut(id: string, laidOut: { width: number; height: number }): void {
  expect(live.get(id)).toEqual(expect.objectContaining(laidOut));
  expect(size(id)).toEqual({ width: live.get(id)!.width, height: live.get(id)!.height });
}

chromium_("a shorthand whose value holds a `var()`", () => {
  it("is carried into the render document under the name it was declared with", () => {
    const css = read.get("shorthands")?.document.css.join("\n") ?? "";
    for (const [property, value] of Object.entries(SHORTHANDS)) {
      expect(css).toContain(`${property}:${value}`);
    }
  });

  it("paints the subject at the size the live page laid it out at", () => {
    // 20 tall, 16 of padding above and below, 4 and 8 of margin inside the
    // flow root: what the page lays out only with every shorthand applied.
    paintsAsLaidOut("shorthands", { width: 400, height: 64 });
  });
});

chromium_("a line height the root declares as a number", () => {
  it("paints the subject at the size the live page laid it out at", () => {
    paintsAsLaidOut("relative-line-height", { width: 400, height: 15 });
  });
});

chromium_("rules in cascade layers", () => {
  it("paints the subject at the size the live page laid it out at", () => {
    paintsAsLaidOut("layers", { width: 400, height: 75 });
  });
});

chromium_("the body styled in a cascade layer", () => {
  it("paints the subject at the size the live page laid it out at", () => {
    paintsAsLaidOut("layered-body", { width: 360, height: 20 });
  });
});
