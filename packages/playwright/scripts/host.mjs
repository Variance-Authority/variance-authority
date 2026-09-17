#!/usr/bin/env node

/**
 * What a paint costs on *this* host, and whether this host's pixels are that
 * host's pixels.
 *
 * `paint.mjs` prices the product's render path on the machine it is run on, and
 * imports the built renderer to do it. This one deliberately imports nothing from
 * the repository, because its whole purpose is to run somewhere the repository is
 * not — inside a container, on a CI runner, on someone else's laptop — so that
 * the bytes producing the left-hand number are the bytes producing the right-hand
 * one. A cross-host comparison between two different scripts measures the
 * scripts.
 *
 * It answers two questions that get confused with each other:
 *
 *   **Is another host affordable?** `--measure` prices launch, reuse and isolate
 *   per engine, the same three arms `paint.mjs` uses, and writes one raster per
 *   engine so the second question has something to work on.
 *
 *   **Is another host's raster interchangeable with this one's?** `--compare`
 *   reads two of those directories and reports geometry, then area and peak at
 *   two scales, then chroma. Timings say a host is cheap. They say nothing about
 *   whether a baseline recorded on it means anything here, and that is the
 *   question a visual suite actually asks of a machine.
 *
 * Run:
 *
 *   node node_modules/@variance-authority/playwright/scripts/host.mjs --out ./native
 *   node node_modules/@variance-authority/playwright/scripts/host.mjs --compare ./native ./box
 *
 * This file ships in the package, imports nothing from the repository it was
 * written in, and resolves `playwright` from the directory you run it in.
 *
 * And on another host — the standard image, arm64 or amd64, browsers already in
 * it, this file the only thing mounted:
 *
 *   docker run --rm --ipc=host --user pwuser -v "$PWD/box:/work" -w /work \
 *     -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
 *     mcr.microsoft.com/playwright:v1.62.1-noble \
 *     sh -c 'npm i playwright@1.62.1 >/dev/null && node host.mjs --out .'
 *
 * `--ipc=host` because Chromium's default `/dev/shm` in a container is 64 MB and
 * it crashes rather than slows down. `--user pwuser` because Chromium's sandbox
 * refuses to run as root, and the alternative — `--no-sandbox` — would make the
 * container arm differ from the native arm in a launch argument, which is exactly
 * the confound this file exists to avoid.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Find `playwright` wherever this host keeps it.
 *
 * A bare specifier resolves against this file's own location, and the two hosts
 * disagree about where the library lives: a workspace `node_modules` here, an
 * install beside the mounted script there. Resolving from the working directory
 * first and falling back to a bare import covers both without the script needing
 * to know which host it is on. Resolution lands on the CommonJS entry, whose
 * named exports arrive under `default` rather than on the namespace, so both
 * shapes are accepted.
 */
async function loadPlaywright() {
  const named = (module) => (module?.chromium === undefined ? module?.default : module);
  const attempts = [];
  for (const [where, resolve] of [
    ['cwd', () => createRequire(pathToFileURL(`${process.cwd()}/`)).resolve('playwright')],
    ['bare', () => 'playwright'],
  ]) {
    try {
      const target = resolve();
      const found = named(await import(target === 'playwright' ? target : pathToFileURL(target).href));
      if (found !== undefined) return found;
      attempts.push(`${where}: resolved, but exported no engines`);
    } catch (error) {
      attempts.push(`${where}: ${String(error).split('\n')[0]}`);
    }
  }
  throw new Error(`playwright is not resolvable from here\n  ${attempts.join('\n  ')}`);
}

const USE = { viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, colorScheme: 'light' };

const now = () => Number(process.hrtime.bigint()) / 1e6;

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return { median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1) };
}

/**
 * Text, because text is the only thing two hosts reliably disagree about, and a
 * value that varies per subject so no engine can serve a cached raster.
 *
 * `font` is either the generic stack — which asks each host to answer with its
 * own typeface, and they do — or a `@font-face` carrying one supplied by the
 * caller. Both are worth shooting: the first is what a subject normally does and
 * the difference it produces is the honest one, the second removes typeface
 * choice from the comparison so that what is left is rasterization alone.
 */
const page = (n, font) => `<!doctype html><meta name="color-scheme" content="light">
<style>${font === null ? '' : `@font-face{font-family:Pinned;src:url(data:font/ttf;base64,${font}) format("truetype")}`}
html,body{margin:0;background:#fff}
#s{display:inline-block;padding:16px 20px;background:#fff;color:#111;border:1px solid #d8d8d8;
   font:15px/1.5 ${font === null ? '-apple-system,system-ui,"Segoe UI",Roboto,sans-serif' : 'Pinned'}}
h1{font:600 18px/1.3 inherit;margin:0 0 8px}
td{padding:3px 14px 3px 0}</style>
<div id="s"><h1>Underwriter demand record ${n}</h1>
<table><tr><td>Handling agent</td><td>Marcus Vale</td></tr>
<tr><td>Outstanding</td><td>${(12480 + n * 37).toLocaleString('en-US')}.00</td></tr>
<tr><td>Reference</td><td>UD-${String(n).padStart(5, '0')}</td></tr></table></div>`;

/**
 * The same measurement on a subject that actually rasterizes.
 *
 * The light subject above is text on a flat fill, which is what the first
 * benchmark measured and what made one engine look like "the fast one". Capture
 * cost and rasterization cost are different quantities charged to different
 * engines, and a subject with almost no raster work reports only the first. This
 * one is 240 blurred, shadowed, gradient-filled cells under a per-subject
 * rotation — no cached raster, and the second quantity dominates.
 *
 * Both are honest subjects. Neither is "the" subject, which is the finding: the
 * engine ordering is a property of the pair, not of the engine, so this file
 * refuses to report one without the other.
 */
const heavy = (n) => `<!doctype html><meta name="color-scheme" content="light">
<style>html,body{margin:0;background:#fff}
#s{box-sizing:border-box;width:420px;height:300px;overflow:hidden;background:#fff;
   border:1px solid #ccc;font:15px/1.5 sans-serif;padding:8px}
i{display:inline-block;width:24px;height:24px;margin:1px;border-radius:6px;
  background:linear-gradient(135deg,#e0303a,#3050e0);box-shadow:0 2px 6px rgba(0,0,0,.4);
  filter:blur(.5px)}</style>
<div id="s">Record ${n}<div style="transform:rotate(${n}deg)">${'<i></i>'.repeat(240)}</div></div>`;

/**
 * The two ways of asking for one rectangle, which are not two spellings of it.
 *
 * `element` is `locator.screenshot()` — what the renderer has always done. Before
 * capturing, it runs Playwright's actionability wait: the subject's box must hold
 * still across two consecutive animation frames. That is ~30ms at 60Hz, charged
 * per subject whether or not anything on the page is moving, and on a light
 * subject it is most of the measurement. `clip` asks the page for the same
 * rectangle and skips the wait.
 *
 * The rect is snapped *outward* — floor the near edge, ceil the far one — because
 * that is what the element path does to a fractional box. Rounded any other way
 * the two paths disagree on every subject whose edges are not already on the
 * pixel grid, which is most real subjects; snapped this way they are byte-identical.
 *
 * `clip` is not a universal replacement, and this file measures it rather than
 * recommending it: a clip rect does not reach outside the viewport, so a subject
 * larger than the viewport comes back truncated. See the renderer for the
 * predicate that decides.
 */
const outward = (box) => ({
  x: Math.floor(box.x),
  y: Math.floor(box.y),
  width: Math.ceil(box.x + box.width) - Math.floor(box.x),
  height: Math.ceil(box.y + box.height) - Math.floor(box.y),
});

const CAPTURE = {
  element: (surface) => surface.locator('#s').screenshot(),
  clip: async (surface) => surface.screenshot({ clip: outward(await surface.locator('#s').boundingBox()) }),
};

/**
 * The product's model: one context, one page, every subject painted through it.
 *
 * A full untimed pass runs first. One warm-up capture is not enough — Chromium's
 * first raster of a *run* differs from its steady state by ±1 LSB on a handful of
 * pixels, and with only one subject warmed the second subject inherits it and
 * `distinct` reports a drift that is a warm-up.
 */
async function reuse(browser, count, font, take, document = page) {
  const context = await browser.newContext(USE);
  const surface = await context.newPage();
  for (let i = 0; i < count; i++) await surface.setContent(document(i % 8, font));

  const images = new Set();
  const samples = [];
  let first;
  for (let i = 0; i < count; i++) {
    const started = now();
    await surface.setContent(document(i % 8, font));
    const bytes = await take(surface);
    samples.push(now() - started);
    if (i % 8 === 0) images.add(createHash('sha256').update(bytes).digest('hex'));
    if (i === 0) first = bytes;
  }

  await context.close();
  return { ...stats(samples), distinct: images.size, image: first };
}

/** The rejected model, priced rather than asserted: a context per subject. */
async function isolate(browser, count, font, take) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const started = now();
    const context = await browser.newContext(USE);
    const surface = await context.newPage();
    await surface.setContent(page(i % 8, font));
    await take(surface);
    await context.close();
    samples.push(now() - started);
  }
  return stats(samples);
}

async function measure({ count, out, font, args }) {
  const engines = await loadPlaywright();
  const rows = [];

  for (const name of ['chromium', 'firefox', 'webkit']) {
    const started = now();
    let browser;
    try {
      // Launch arguments reach Chromium only. No other engine accepts them, so
      // passing them along would be a silent no-op on two of three rows.
      browser = await engines[name].launch(name === 'chromium' ? { args } : {});
    } catch (error) {
      rows.push({ name, error: String(error).split('\n')[0].slice(0, 68) });
      continue;
    }
    const launch = now() - started;
    const version = browser.version();
    const held = await reuse(browser, count, font, CAPTURE.element);
    const heldFast = await reuse(browser, count, font, CAPTURE.clip);
    // The same two capture paths on the raster-heavy subject. Reuse only: the
    // isolation tax is a context-creation cost and does not care what is drawn.
    const drawn = await reuse(browser, count, font, CAPTURE.element, heavy);
    const drawnFast = await reuse(browser, count, font, CAPTURE.clip, heavy);
    const apart = await isolate(browser, count, font, CAPTURE.element);
    const apartFast = await isolate(browser, count, font, CAPTURE.clip);
    await browser.close();

    // The raster written out is the element path's, so a `--compare` against a
    // directory recorded before this arm existed is still comparing like with
    // like. Whether the fast path produced the same bytes is reported rather
    // than assumed — it is the claim the whole arm rests on.
    if (out !== null) writeFileSync(join(out, `${name}.png`), held.image);
    rows.push({
      name,
      version,
      launch: +launch.toFixed(0),
      reuse: { median: held.median, p95: held.p95, distinct: held.distinct },
      reuseClip: { median: heldFast.median, p95: heldFast.p95, distinct: heldFast.distinct },
      heavy: { median: drawn.median, p95: drawn.p95 },
      heavyClip: { median: drawnFast.median, p95: drawnFast.p95 },
      isolate: apart,
      isolateClip: apartFast,
      agree: held.image.equals(heldFast.image),
      sha: createHash('sha256').update(held.image).digest('hex').slice(0, 12),
    });
  }

  const where = `${process.platform}/${process.arch}`;
  console.log(`\nhost: ${where}  node ${process.versions.node}  ${count} paints per arm`);
  console.log(`font: ${font === null ? 'whatever this host answers system-ui with' : 'supplied, identical on every host'}`);
  console.log(`args: ${args.length === 0 ? '(none)' : args.join(' ')}\n`);
  console.log('                              launch  -- light --  -- heavy --   -- isolate --');
  console.log('engine      version                    element  clip  element  clip   element  clip    tax   images  raster   clip bytes');
  for (const row of rows) {
    if (row.error !== undefined) {
      console.log(`${row.name.padEnd(11)} ${row.error}`);
      continue;
    }
    console.log(
      `${row.name.padEnd(11)} ${row.version.padEnd(15)} ${String(row.launch).padStart(5)}ms` +
        ` ${String(row.reuse.median).padStart(7)} ${String(row.reuseClip.median).padStart(5)}` +
        ` ${String(row.heavy.median).padStart(7)} ${String(row.heavyClip.median).padStart(5)}` +
        `  ${String(row.isolate.median).padStart(7)} ${String(row.isolateClip.median).padStart(5)}` +
        `  ${(row.isolate.median / row.reuse.median).toFixed(1).padStart(5)}x` +
        `   ${row.reuse.distinct === 1 ? 'stable' : `${row.reuse.distinct} DRIFT`}  ${row.sha}` +
        `   ${row.agree ? 'match' : 'DIFFER'}`,
    );
  }
  console.log('\nms per paint, median. reuse holds one context and one page; isolate opens');
  console.log('and closes a context per paint. launch is the browser process alone.');
  console.log('element is locator.screenshot(); clip is page.screenshot({clip}) over the same');
  console.log('rectangle, which skips the two-frame actionability wait the element path runs.');
  console.log('clip bytes: whether the two paths produced the same image. tax is on the element');
  console.log('path, so it stays comparable with runs recorded before the clip arm existed.');
  console.log('images: distinct rasters of the same document — anything but "stable" is a finding.');
  console.log('light is text on a flat fill; heavy is 240 blurred, shadowed, rotated gradient');
  console.log('cells. Both are reuse. Read them together: capture cost and rasterization cost');
  console.log('are charged to different engines, and one subject alone reports only one of');
  console.log('them. isolate and the raster digest are the light subject, so a --compare');
  console.log('against a directory recorded earlier is still comparing like with like.\n');
  console.log(JSON.stringify({ host: where, count, rows }));
}

const LINEAR = new Float64Array(256);
for (let value = 0; value < 256; value++) {
  const channel = value / 255;
  LINEAR[value] = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

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
 * Two hosts differ everywhere a glyph edge falls, so a pixel count reads as
 * catastrophe on a difference nobody can see. Decimating first is what separates
 * the two kinds of disagreement: host noise is broad and shallow, a defect is
 * narrow and deep. A size mismatch is not measured — two subjects of different
 * widths have already answered the question, and padding one to the other invents
 * a difference in the padding rather than reporting the one that is there.
 */
function agreement(left, right, k) {
  if (left.width !== right.width || left.height !== right.height) return null;
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

/**
 * Pixels whose channels disagree, on a subject that is black text on white.
 *
 * Grey text has R=G=B. A non-zero count is subpixel antialiasing — the host
 * painting for one LCD's stripe order — and it is the one rasterization
 * difference no tolerance reconciles, because it is coloured. Chromium turns it
 * on by default wherever fontconfig is live; `CHROMIUM_RASTER_ARGS` is what turns
 * it back off, and this is the column that says whether it did.
 */
function chroma(image) {
  let count = 0;
  for (let at = 0; at < image.data.length; at += 4) {
    const r = image.data[at];
    const g = image.data[at + 1];
    const b = image.data[at + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 2) count++;
  }
  return count;
}

async function compare(leftDir, rightDir) {
  // Imported here rather than at the top, because `--measure` is the mode that
  // runs somewhere else and it must not need anything this repository publishes.
  let decode;
  try {
    const from = createRequire(pathToFileURL(`${process.cwd()}/`));
    ({ pngjsDecoder: { decode } = {} } = await import(
      pathToFileURL(from.resolve('@variance-authority/png')).href
    ));
  } catch {
    console.error('--compare needs @variance-authority/png resolvable from this directory.');
    console.error('Install it here, or use --out, which needs nothing but playwright.');
    process.exitCode = 1;
    return;
  }

  const read = async (dir, name) => decode(readFileSync(join(dir, name)));
  const names = readdirSync(leftDir)
    .filter((it) => it.endsWith('.png'))
    .sort();

  console.log(`\nleft:  ${leftDir}\nright: ${rightDir}\n`);
  console.log('engine      geometry              1x1 area    peak    4x4 area    peak   chroma L/R');
  for (const name of names) {
    const left = await read(leftDir, name);
    const right = await read(rightDir, name);
    const fine = agreement(left, right, 1);
    const coarse = agreement(left, right, 4);
    const size = `${left.width}x${left.height} / ${right.width}x${right.height}`;
    console.log(
      `${name.replace(/\.png$/, '').padEnd(11)} ${size.padEnd(21)} ` +
        (fine === null
          ? 'differs — nothing else measured   '
          : `${String(fine.area).padStart(8)}% ${String(fine.peak).padStart(6)}% ` +
            `${String(coarse.area).padStart(10)}% ${String(coarse.peak).padStart(6)}%`) +
        `   ${chroma(left)}/${chroma(right)}`,
    );
  }
  console.log('\narea = blocks differing by more than 2% luminance. peak = the worst one.');
  console.log('chroma = pixels whose channels disagree, i.e. subpixel antialiasing.\n');
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1];
};

if (argv[0] === '--compare') {
  if (argv.length < 3) {
    console.error('usage: host.mjs --compare <left-dir> <right-dir>');
    process.exitCode = 1;
  } else {
    await compare(argv[1], argv[2]);
  }
} else {
  const fontFile = flag('--font');
  await measure({
    count: Number(argv.find((it) => /^\d+$/.test(it)) ?? 40),
    out: flag('--out'),
    // Base64 rather than a path, so the page carries the font instead of asking
    // the host to find it — the host having its own answer is the confound.
    font: fontFile === null ? null : readFileSync(fontFile).toString('base64'),
    args: flag('--args') === null ? [] : flag('--args').split(','),
  });
}
