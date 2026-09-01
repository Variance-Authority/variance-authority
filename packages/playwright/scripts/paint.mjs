#!/usr/bin/env node

/**
 * What a paint costs on this machine, per engine, under the model we actually run.
 *
 * The number that matters is **per render with the browser already open and the
 * page already there** — ADR-0009's arrangement, applied to the raster tier.
 * Playwright's own fixture throws a context and a page away between subjects, and
 * a benchmark shaped like that measures the teardown rather than the paint: it
 * reports Chromium fastest, because Chromium opens a page in ~26 ms where WebKit
 * takes ~125 ms, and it charges that to every subject. Under reuse the ordering
 * inverts and WebKit paints roughly twice as fast as Chromium.
 *
 * So both arms run here, and the second one exists to be quoted against the first:
 *
 *   reuse   — one renderer, every document painted through it. The page pool
 *             leases a page per viewport and hands it back. This is the product.
 *   isolate — a renderer per document, opened and closed around each paint. The
 *             rejected model, priced rather than asserted.
 *
 * Nothing about a subject changes between renders, which is the point: the same
 * document painted N times must produce N identical images, and `distinct` says
 * whether it did. A renderer that drifts under reuse is a finding — the fix is
 * the subject or the recipe, never a tolerance and never a reload.
 *
 * The first paint of a run is discarded. Chromium's first raster differs from its
 * steady state by ±1 LSB on a handful of pixels, which is a warm-up rather than a
 * change; keeping it would put that into every median on one engine only.
 *
 * Engines are discovered, not assumed: a machine with one installed measures one
 * and says so, the same discipline as `src/engines.chromium.test.ts`.
 *
 * Run:  yarn workspace @variance-authority/playwright paint
 *       yarn workspace @variance-authority/playwright paint 60
 *       yarn workspace @variance-authority/playwright paint 60 --json
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { createPlaywrightRenderer } from '../dist/renderer.js';

const ENGINES = { chromium, firefox, webkit };

/** Installed, by asking Playwright where the binary is rather than launching it. */
function installed(engine) {
  try {
    return existsSync(engine.executablePath());
  } catch {
    return false;
  }
}

const VIEWPORT = { width: 400, height: 200, deviceScaleFactor: 1, colorScheme: 'light' };

/**
 * A subject with text in it, because text is where engines disagree and where
 * the time goes. A solid rectangle would paint faster everywhere and would say
 * nothing about the machine anybody runs.
 */
function documentFor() {
  return {
    documentVersion: 1,
    subject: { id: 'paint/panel', kind: 'fixture' },
    html:
      '<div data-va-path="0" style="width:320px;padding:16px;font:16px/1.4 serif">' +
      'Cross-engine subject with enough text to wrap onto a second line.</div>',
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

const now = () => Number(process.hrtime.bigint()) / 1e6;

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return {
    n: sorted.length,
    min: +sorted[0].toFixed(1),
    median: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1),
  };
}

/** Every render through one renderer, which is how a run paints. */
async function reuse(browser, document, count) {
  const renderer = await createPlaywrightRenderer({ browser });
  try {
    await renderer.render(document);
    const samples = [];
    const images = new Set();
    for (let i = 0; i < count; i++) {
      const started = now();
      const raster = await renderer.render(document);
      samples.push(now() - started);
      images.add(createHash('sha256').update(raster.bytes).digest('hex'));
    }
    return { perRender: stats(samples), distinct: images.size };
  } finally {
    await renderer.close();
  }
}

/** A renderer per render: the launch and the teardown charged to every subject. */
async function isolate(browser, document, count) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const started = now();
    const renderer = await createPlaywrightRenderer({ browser });
    await renderer.render(document);
    await renderer.close();
    samples.push(now() - started);
  }
  return { perRender: stats(samples) };
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const count = Number(args.find((argument) => /^\d+$/.test(argument)) ?? 20);
// The rejected arm is the expensive one and its spread is narrow; a quarter of
// the samples prices it without quadrupling the run.
const isolated = Math.max(3, Math.round(count / 4));

const available = Object.entries(ENGINES).filter(([, engine]) => installed(engine));
if (available.length === 0) {
  console.error('no engines installed — npx playwright install chromium firefox webkit');
  process.exit(1);
}

const document = documentFor();
const results = {};

for (const [name] of available) {
  const under = await reuse(name, document, count);
  const without = await isolate(name, document, isolated);
  results[name] = {
    reuse: under.perRender,
    isolate: without.perRender,
    tax: +(without.perRender.median / under.perRender.median).toFixed(1),
    distinct: under.distinct,
  };
}

if (json) {
  console.log(JSON.stringify({ count, isolated, viewport: VIEWPORT, results }, null, 2));
} else {
  const missing = Object.keys(ENGINES).filter((name) => results[name] === undefined);
  console.log(`\n${count} renders per engine, one document, ${VIEWPORT.width}x${VIEWPORT.height} @1x\n`);
  console.log('engine      reuse (ms)   isolate (ms)   tax    images');
  for (const [name, result] of Object.entries(results)) {
    console.log(
      `${name.padEnd(11)} ${String(result.reuse.median).padStart(6)}` +
        `       ${String(result.isolate.median).padStart(7)}` +
        `      ${String(result.tax).padStart(4)}x` +
        `   ${result.distinct === 1 ? '1 (stable)' : `${result.distinct} — DRIFT`}`,
    );
  }
  if (missing.length > 0) console.log(`\nnot installed: ${missing.join(', ')}`);
  console.log(
    '\nreuse is the median with the browser open and the page leased; isolate opens\n' +
      'and closes a renderer around every paint. `images` is how many distinct\n' +
      'rasters the identical document produced — anything but 1 is a finding.\n',
  );
}
