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
 * A form somebody typed into, read by the collector every page agent shares.
 *
 * A Storybook play function, a Playwright `fill`, a route that restores a draft:
 * each leaves the state of a form control in the element's *properties* —
 * `value`, `checked`, `selectedIndex` — and none of them writes an attribute.
 * The markup still says what the server sent. So a document acquired from the
 * page describes a form nobody filled in, and the deferred renderer, which
 * paints only what the document says, paints that one.
 *
 * Every page below is the same form. One of them sets one control from script
 * after mount, the way a play function does; the blank page sets nothing. Each
 * case compares one such page with the blank one, through both products of the
 * one read: the image the renderer paints from the document, and the snapshot
 * the comparison runs on. The control case puts the same value in the markup
 * instead, so a renderer that painted every form the same would fail it, and
 * the live page is photographed too, so a script that never ran would fail the
 * first case rather than pass the rest.
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
    "\npackages/route-collector (form state): skipped." +
      "\n  no browser — npx playwright install chromium\n",
  );
}

const PASSWORD =
  '<input id="name" type="password" aria-label="Name" autocomplete="current-password">';
const SECRET = "correct horse";
const FILE = '<input id="name" type="file" aria-label="Name">';
const FILE_NAME = "notes-for-ada.txt";

function form(input = '<input id="name" aria-label="Name">'): string {
  return `<main id="app"><form>
      ${input}
      <textarea id="notes" aria-label="Notes" rows="2" cols="20"></textarea>
      <select id="size" aria-label="Size">
        <option value="s">Small</option>
        <option value="l">Large</option>
      </select>
      <input id="gift" type="checkbox" aria-label="Gift">
    </form></main>`;
}

/** What a play function leaves behind: a property set, an event fired, no attribute. */
function typed(statement: string, input?: string): string {
  return `<!doctype html><html><body>${form(input)}<script>
      ${statement}
      document.querySelector('form').dispatchEvent(new Event('input', { bubbles: true }));
    </script></body></html>`;
}

const PAGES: Readonly<Record<string, string>> = {
  "/blank": `<!doctype html><html><body>${form()}</body></html>`,
  "/input": typed(`document.querySelector('#name').value = 'Ada Lovelace';`),
  "/textarea": typed(
    `document.querySelector('#notes').value = 'Leave at the door';`,
  ),
  "/select": typed(`document.querySelector('#size').value = 'l';`),
  "/checkbox": typed(`document.querySelector('#gift').checked = true;`),
  "/attribute": `<!doctype html><html><body>${form(
    '<input id="name" aria-label="Name" value="Ada Lovelace">',
  )}</body></html>`,
  "/password-blank": `<!doctype html><html><body>${form(PASSWORD)}</body></html>`,
  "/password": typed(
    `document.querySelector('#name').value = '${SECRET}';`,
    PASSWORD,
  ),
  // A file chosen from script, the way Playwright's `setInputFiles` does. The
  // count goes on the root, so the document shows the script ran.
  "/file": typed(
    `const chosen = new DataTransfer();
      chosen.items.add(new File(['x'], '${FILE_NAME}'));
      document.querySelector('#name').files = chosen.files;
      document.querySelector('#app').dataset.chosen = String(chosen.files.length);`,
    FILE,
  ),
  // Controls whose properties already say what their markup says, though the
  // two read differently: a colour and a range hold a value no attribute names,
  // a number drops the one it was given, a select shows its first option.
  "/untouched": `<!doctype html><html><body><main id="app"><form>
      <input type="color" aria-label="Colour">
      <input type="range" aria-label="Volume" min="0" max="10">
      <input type="number" aria-label="Count" value="many">
      <input type="email" aria-label="Email" value=" ada@example.com ">
      <textarea aria-label="Notes">Leave at the door</textarea>
      <select aria-label="Size"><option>Small</option><option>Large</option></select>
      <select aria-label="Fit"><option>Slim</option><option selected>Loose</option></select>
      <input type="checkbox" aria-label="Gift" checked>
    </form></main></body></html>`,
};

const IDS = Object.keys(PAGES).map((path) => `form${path}`);

const PLAN: Plan = {
  subjects: IDS.map((id) => ({ subject: { id, kind: "route" as const } })),
  notObserved: [],
  warnings: [],
};

let server: Server | undefined;
let collector: Collector | undefined;
let renderer: Awaited<ReturnType<typeof createPlaywrightRenderer>> | undefined;
const read = new Map<string, Extract<Collected, { ok: true }>>();
const painted = new Map<string, Raster>();
const seen = new Map<string, string>();
const markup = new Map<string, string>();

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
      Object.keys(PAGES).map((path) => [`form${path}`, `${base}${path}`]),
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
      // Read before the photograph: a screenshot leaves `style=""` on every
      // control it hid the caret in.
      markup.set(
        `form${path}`,
        await page.locator("#app").evaluate((app) => app.outerHTML),
      );
      seen.set(
        `form${path}`,
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
  return painted.get(`form/${id}`)?.bytes;
}

function renderHash(id: string): string | undefined {
  return read.get(`form/${id}`)?.snapshot?.renderHash;
}

function live(id: string): string | undefined {
  return seen.get(`form/${id}`);
}

chromium_("a form filled in after mount, on the live page", () => {
  it("shows every control a script filled in", () => {
    expect(live("blank")).toBeDefined();
    for (const id of ["input", "textarea", "select", "checkbox", "attribute"]) {
      expect(live(id), id).not.toBe(live("blank"));
    }
  });
});

chromium_(
  "a form filled in after mount, painted from its render document",
  () => {
    it("paints a value written into the markup, so the comparison below can fail", () => {
      expect(image("attribute")).toBeDefined();
      expect(image("attribute")).not.toBe(image("blank"));
    });

    it("paints the text a script typed into an input", () => {
      expect(image("input")).not.toBe(image("blank"));
    });

    it("paints the text a script typed into a textarea", () => {
      expect(image("textarea")).not.toBe(image("blank"));
    });

    it("paints the option a script chose in a select", () => {
      expect(image("select")).not.toBe(image("blank"));
    });

    it("paints the tick a script put in a checkbox", () => {
      expect(image("checkbox")).not.toBe(image("blank"));
    });
  },
);

chromium_("a form filled in after mount, compared through its snapshot", () => {
  it("moves the snapshot for a value written into the markup, so the comparisons below can fail", () => {
    expect(renderHash("attribute")).toBeDefined();
    expect(renderHash("attribute")).not.toBe(renderHash("blank"));
  });

  it("moves the snapshot for the text a script typed into an input", () => {
    expect(renderHash("input")).toBeDefined();
    expect(renderHash("input")).not.toBe(renderHash("blank"));
  });

  it("moves the snapshot for the text a script typed into a textarea", () => {
    expect(renderHash("textarea")).not.toBe(renderHash("blank"));
  });

  it("moves the snapshot for the option a script chose in a select", () => {
    expect(renderHash("select")).not.toBe(renderHash("blank"));
  });

  it("moves the snapshot for the tick a script put in a checkbox", () => {
    // Green before the form's live state was written in: `ariaOf` reads
    // `HTMLInputElement.checked` rather than the attribute.
    expect(renderHash("checkbox")).not.toBe(renderHash("blank"));
  });
});

chromium_("a form nobody filled in, and one holding a password or a file", () => {
  it("writes nothing into the document of a form whose markup already says what it holds", () => {
    const document = read.get("form/untouched")?.document.html;
    expect(markup.get("form/untouched")).toBeDefined();
    expect(document?.replace(/ data-va-path="[^"]*"/g, "")).toBe(
      markup.get("form/untouched"),
    );
  });

  it("paints the dots of a password typed after mount", () => {
    expect(image("password")).toBeDefined();
    expect(image("password")).not.toBe(image("password-blank"));
  });

  it("moves the snapshot for a password typed after mount", () => {
    expect(renderHash("password")).toBeDefined();
    expect(renderHash("password")).not.toBe(renderHash("password-blank"));
  });

  it("carries the password into neither the document nor the snapshot", () => {
    const collected = JSON.stringify(read.get("form/password"));
    expect(collected).toContain("•".repeat(SECRET.length));
    expect(collected).not.toContain(SECRET);
  });

  it("carries a chosen file's name into neither the document nor the snapshot", () => {
    // The guard, not the reparse, keeps it out: a file input reparsed from its
    // markup holds no file, so the reparse would call `C:\fakepath\…` state.
    const collected = JSON.stringify(read.get("form/file"));
    expect(read.get("form/file")?.document.html).toContain('data-chosen="1"');
    expect(collected).not.toContain(FILE_NAME);
    expect(collected).not.toContain("fakepath");
  });
});
