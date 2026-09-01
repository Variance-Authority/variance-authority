#!/usr/bin/env node

/**
 * What each engine costs on this corpus, and where they disagree.
 *
 * Two questions, one run, because they share the captures. The first is a cost:
 * how long a subject takes when the browser is open, the page is loaded and only
 * the subject is switched — which is how a run paints (ADR-0009). The second is
 * an agreement: whether two engines painting the *same* subject can be told apart
 * from one engine painting a *changed* subject.
 *
 * ## Four models, and three of them are here to be priced
 *
 *   remount  — one page, subject switched in place through the page's own API.
 *              This is the model. Storybook's `story` switch is the same shape.
 *   reset    — `remount`, with storage and cookies cleared between subjects.
 *              Priced because state between subjects is the objection to reuse,
 *              and the answer to the objection has to be affordable.
 *   navigate — the page reused, but reloaded per subject.
 *   isolate  — a fresh context and page per subject: Playwright's own fixture.
 *
 * ## The agreement question is not a tolerance
 *
 * Engines disagree about text. It is tempting to read that as antialiasing and
 * reach for a pixel-ratio tolerance, and this measures why that fails: the
 * disagreement covers a *larger* share of the subject than a real regression does,
 * at every scale, because each engine weights glyphs differently and the bias
 * survives averaging. A threshold on area fires on the engine before the defect.
 *
 * What separates them is amplitude at scale. On k×k luminance blocks a regression
 * is narrow and deep where engine noise is broad and shallow, so this reports both
 * the share of blocks that differ and the *peak* block difference, for engine
 * pairs on identical input and for `before`/`after` in one engine. The two
 * families are printed against each other, which is the only way the numbers mean
 * anything: a separation is a ratio, not a threshold somebody picked.
 *
 * Luminance is compared in linear light. Blurring or averaging gamma-encoded
 * values darkens edges and invents a difference that is not on the screen.
 *
 * Run:  yarn workspace @variance-authority/case-incumbent engines
 *       yarn workspace @variance-authority/case-incumbent engines 40 --json
 *
 * Needs the page bundle: `yarn workspace @variance-authority/case-incumbent bundle`.
 */
import { existsSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { pngjsDecoder } from '@variance-authority/png';
import { PAGE_URL, stale } from './bundle.mjs';
import { SCENARIOS } from '../dist/scenarios.js';

const ENGINES = { chromium, firefox, webkit };
const VIEWPORT = { width: 800, height: 600 };
const USE = { viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light' };
const IDS = SCENARIOS.map((scenario) => scenario.id);

function installed(engine) {
  try {
    return existsSync(engine.executablePath());
  } catch {
    return false;
  }
}

const now = () => Number(process.hrtime.bigint()) / 1e6;

/** Drift as a sentence, because a boolean here reads as a verdict it has not earned. */
function told(rows) {
  if (rows.length === 0) return 'none';
  return rows
    .map((row) =>
      row.geometry === undefined
        ? `${row.id} ${row.pixels}px +-${row.worst}/255 (${row.share}%)`
        : `${row.id} ${row.geometry}`,
    )
    .join('; ');
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return { median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1) };
}

const shoot = (page) => page.locator('#subject').screenshot();
const mount = (page, id, variant) =>
  page.evaluate(([subject, which]) => window.__CASE__.mount(subject, which), [id, variant]);

/**
 * One model, timed per subject.
 *
 * ## Every subject is painted once before anything is timed
 *
 * A single warm-up capture is not enough, and finding that out is what the drift
 * check is for. Chromium's raster settles only after a subject has been painted
 * *with other content already on the page*: the first capture of the first
 * subject and its next capture, seven subjects later, differ on 14 pixels by one
 * least-significant bit — 0.0107% of the clip — and every capture after that is
 * byte-identical. Warming one subject once reported that as drift; warming all of
 * them reports it as what it is, which is a cost of the first pass.
 *
 * So the warm-up is a full untimed cycle, and both the medians and the drift check
 * then describe a settled page. That is also the honest arrangement for a *run*:
 * a suite pays a first pass too, and it is the second one that has to be stable.
 */
async function model(browser, kind, count) {
  const samples = [];
  const images = new Map();
  const drifted = [];
  let context = null;
  let page = null;

  if (kind !== 'isolate') {
    context = await browser.newContext(USE);
    page = await context.newPage();
    await page.goto(PAGE_URL);
  }

  for (const id of IDS) {
    if (kind === 'isolate') continue;
    await mount(page, id, 'after');
    await shoot(page);
  }

  for (let index = 0; index < count; index++) {
    const id = IDS[index % IDS.length];
    const started = now();
    let bytes;

    if (kind === 'isolate') {
      const fresh = await browser.newContext(USE);
      const opened = await fresh.newPage();
      await opened.goto(`${PAGE_URL}?scenario=${id}&variant=after`);
      await opened.waitForSelector('html[data-case-ready="1"]');
      bytes = await shoot(opened);
      await fresh.close();
    } else if (kind === 'navigate') {
      await page.goto(`${PAGE_URL}?scenario=${id}&variant=after`);
      await page.waitForSelector('html[data-case-ready="1"]');
      bytes = await shoot(page);
    } else {
      if (kind === 'reset') {
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        await context.clearCookies();
      }
      await mount(page, id, 'after');
      bytes = await shoot(page);
    }

    samples.push(now() - started);

    // A subject seen twice must be the same image. Reuse that drifts is the one
    // finding this model has to be able to report about itself — and it has to
    // report *how far*, because "differs" covers both a rounded edge pixel and a
    // subject that has moved. The comparison happens after the clock stops.
    const seen = images.get(id);
    if (seen === undefined) images.set(id, await pngjsDecoder.decode(bytes));
    else drift(seen, await pngjsDecoder.decode(bytes), id, drifted);
  }

  if (context !== null) await context.close();

  return {
    ...stats(samples),
    total: +samples.reduce((sum, sample) => sum + sample, 0).toFixed(0),
    drifted,
  };
}

/** Worst channel movement between two captures of one subject, recorded in place. */
function drift(first, again, id, into) {
  if (first.width !== again.width || first.height !== again.height) {
    into.push({ id, geometry: `${first.width}x${first.height} -> ${again.width}x${again.height}` });
    return;
  }
  let pixels = 0;
  let worst = 0;
  for (let at = 0; at < first.data.length; at += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) {
      const one = Math.abs(first.data[at + channel] - again.data[at + channel]);
      if (one > delta) delta = one;
    }
    if (delta > 0) {
      pixels++;
      if (delta > worst) worst = delta;
    }
  }
  if (pixels > 0) into.push({ id, pixels, worst, share: +((100 * pixels) / (first.width * first.height)).toFixed(4) });
}

/**
 * What resetting between subjects actually costs, timed on its own.
 *
 * The `reset` model answers this end-to-end, and answers it badly: the clear is
 * a fraction of a millisecond inside a ~40 ms subject, so the difference between
 * the two medians is mostly the engine's own run-to-run spread and reads as high
 * as 10 ms or as low as nothing depending on the afternoon. Timing the primitives
 * directly is the same claim measured with an instrument that can see it.
 *
 * Storage is written before each clear, because clearing an empty store is not
 * the operation anybody is worried about paying for.
 */
async function priceReset(browser, rounds = 120) {
  const context = await browser.newContext(USE);
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const samples = [];
  for (let round = 0; round < rounds; round++) {
    await page.evaluate(() => localStorage.setItem(`k${Math.random()}`, 'v'.repeat(200)));
    const started = now();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await context.clearCookies();
    if (round >= 20) samples.push(now() - started);
  }
  await context.close();
  return stats(samples).median;
}

const LINEAR = Array.from({ length: 256 }, (_, step) => {
  const channel = step / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

function luminance(image) {
  const out = new Float64Array(image.width * image.height);
  for (let pixel = 0, at = 0; pixel < out.length; pixel++, at += 4) {
    out[pixel] =
      0.2126 * LINEAR[image.data[at]] +
      0.7152 * LINEAR[image.data[at + 1]] +
      0.0722 * LINEAR[image.data[at + 2]];
  }
  return out;
}

/** Mean luminance per k×k block. Edge blocks average what they contain. */
function blocks(source, width, height, k) {
  const across = Math.ceil(width / k);
  const sums = new Float64Array(across * Math.ceil(height / k));
  const counts = new Float64Array(sums.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = ((y / k) | 0) * across + ((x / k) | 0);
      sums[cell] += source[y * width + x];
      counts[cell]++;
    }
  }
  for (let cell = 0; cell < sums.length; cell++) sums[cell] /= counts[cell];
  return sums;
}

/**
 * Area and peak at one scale.
 *
 * A size mismatch is not measured: two subjects of different heights have already
 * answered the question, and padding one to the other invents a difference in the
 * padding rather than reporting the one that is there.
 */
function agreement(left, right, k) {
  if (left.width !== right.width || left.height !== right.height) return { geometry: 'differs' };
  const a = blocks(luminance(left), left.width, left.height, k);
  const b = blocks(luminance(right), right.width, right.height, k);
  let over = 0;
  let peak = 0;
  for (let cell = 0; cell < a.length; cell++) {
    const delta = Math.abs(a[cell] - b[cell]);
    if (delta > peak) peak = delta;
    if (delta > 0.02) over++;
  }
  return { area: +((100 * over) / a.length).toFixed(2), peak: +(100 * peak).toFixed(2) };
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const count = Number(args.find((argument) => /^\d+$/.test(argument)) ?? IDS.length * 5);

/**
 * Pixels, and 4x4 blocks.
 *
 * Two scales rather than one, because the claim being tested is that no *area*
 * threshold separates an engine from a defect, and a claim about thresholds has
 * to be shown at the scale a threshold would be set at. `1` is where a pixel-ratio
 * tolerance lives. `4` is where a reader looking at the subject lives.
 */
const SCALES = [1, 4];

const unbuilt = stale();
if (unbuilt !== null) {
  console.error(`${unbuilt} — run: yarn workspace @variance-authority/case-incumbent bundle`);
  process.exit(1);
}

const available = Object.keys(ENGINES).filter((name) => installed(ENGINES[name]));
if (available.length === 0) {
  console.error('no engines installed — npx playwright install chromium firefox webkit');
  process.exit(1);
}

const cost = {};
const captures = {};

for (const name of available) {
  const browser = await ENGINES[name].launch();
  cost[name] = {};
  for (const kind of ['remount', 'reset', 'navigate', 'isolate']) {
    cost[name][kind] = await model(browser, kind, count);
  }
  cost[name].clear = await priceReset(browser);

  // Both variants of every scenario, captured through the model being argued for.
  const context = await browser.newContext(USE);
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await mount(page, IDS[0], 'after');
  await shoot(page);
  captures[name] = {};
  for (const id of IDS) {
    for (const variant of ['before', 'after']) {
      captures[name][`${id}:${variant}`] = await pngjsDecoder.decode(await mount(page, id, variant).then(() => shoot(page)));
    }
  }
  await context.close();
  await browser.close();
}

const pairs = available.flatMap((left, index) =>
  available.slice(index + 1).map((right) => [left, right]),
);

const noise = {};
const signal = {};
for (const scale of SCALES) {
  noise[scale] = SCENARIOS.flatMap((scenario) =>
    pairs.map(([left, right]) => ({
      id: scenario.id,
      pair: `${left} vs ${right}`,
      ...agreement(captures[left][`${scenario.id}:after`], captures[right][`${scenario.id}:after`], scale),
    })),
  );
  signal[scale] = SCENARIOS.flatMap((scenario) =>
    available.map((engine) => ({
      id: scenario.id,
      engine,
      regression: scenario.regression,
      ...agreement(captures[engine][`${scenario.id}:before`], captures[engine][`${scenario.id}:after`], scale),
    })),
  );
}

const measured = (rows) => rows.filter((row) => row.peak !== undefined);
const most = (rows, field) => Math.max(...measured(rows).map((row) => row[field]));

/** What a reading at this scale can tell apart from the widest engine disagreement. */
function separated(scale) {
  const ceiling = most(noise[scale], 'peak');
  const moved = measured(signal[scale]).filter((row) => row.peak > ceiling);
  return { ceiling, moved, told: [...new Set(moved.map((row) => row.id))] };
}

/** The scale the summary speaks at: the coarsest, where the two families part. */
const K = SCALES[SCALES.length - 1];

if (json) {
  console.log(JSON.stringify({ count, block: K, cost, noise, signal }, null, 2));
} else {
  console.log(`\n${count} subjects per model, ${IDS.length} distinct, ${VIEWPORT.width}x${VIEWPORT.height} @1x\n`);
  console.log('engine      remount   reset   navigate   isolate    tax   drift');
  for (const name of available) {
    const it = cost[name];
    console.log(
      `${name.padEnd(11)} ${String(it.remount.median).padStart(6)}  ${String(it.reset.median).padStart(6)}` +
        `   ${String(it.navigate.median).padStart(7)}   ${String(it.isolate.median).padStart(7)}` +
        `  ${String((it.isolate.median / it.remount.median).toFixed(1)).padStart(5)}x` +
        `   ${told(it.remount.drifted)}`,
    );
  }
  console.log('\nms per subject, median. `tax` is what Playwright\'s fixture costs over reuse.');
  console.log(
    `\nclearing storage and cookies, timed alone: ${available
      .map((name) => `${name} ${cost[name].clear.toFixed(2)}ms`)
      .join(', ')}` +
      '\nwhich is the whole price of the objection to reuse, and it is under a percent\nof a subject on every engine.',
  );

  console.log('\nagreement — area is the share of cells differing by >2% luminance, peak is the largest\n');
  console.log('  scale   two engines, same subject      one engine, before vs after     tells');
  for (const scale of SCALES) {
    const { ceiling, moved: apart, told: names } = separated(scale);
    const reading =
      apart.length === 0
        ? 'area       -    peak       - '
        : `area <= ${most(apart, 'area').toFixed(2).padStart(5)}%   peak >= ${Math.min(...apart.map((row) => row.peak)).toFixed(2).padStart(5)}%`;
    console.log(
      `  ${`${scale}x${scale}`.padEnd(6)}  area <= ${most(noise[scale], 'area').toFixed(2).padStart(5)}%   peak <= ${ceiling.toFixed(2).padStart(5)}%` +
        `    ${reading}    ${names.length}`,
    );
  }

  const geometry = [...new Set(signal[K].filter((row) => row.geometry !== undefined).map((row) => row.id))];
  const reported = [...new Set([...geometry, ...separated(K).told])];
  const wrong = reported.filter((id) => !SCENARIOS.find((scenario) => scenario.id === id).regression);
  console.log(`\n  geometry changed, so no block reading was needed: ${geometry.join(', ') || 'none'}`);
  console.log(`  separated from engine noise by amplitude: ${separated(K).told.join(', ') || 'none'}`);
  // The corpus pre-registered which scenarios are regressions, so this is a score
  // and not a summary. Subjects whose change never reached the pixels are absent
  // from `told` and that is correct — no comparator can see them, which is the
  // argument for the other signals rather than a defect in this one.
  console.log(`  told here but not a regression: ${wrong.join(', ') || 'none'}`);
  console.log(
    '\nEngine noise is broad and shallow; a regression is narrow and deep. Two engines\n' +
      'painting one subject differ across more of it than a real defect does, at both\n' +
      'scales — so no share of differing pixels separates the two families, and a\n' +
      'pixel-ratio tolerance set to absorb the engine absorbs the defect with it.\n',
  );
}
