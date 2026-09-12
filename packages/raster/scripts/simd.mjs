// What SIMD buys the YIQ metric, and what the boundary charges for it.
//
//   yarn workspace @variance-authority/raster simd
//
// Three arms, because the interesting number is not the middle one:
//
//   * the JS kernel as shipped, in the runtime that actually runs it;
//   * the same arithmetic as SIMD128, timed with the images already in wasm
//     memory — the number a rewrite quotes;
//   * the same call with the copies included — the number a caller pays,
//     because the decoders this package is fed by (pngjs, sharp, Chromium)
//     all hand back a JS-heap array and none of them can write into a wasm
//     linear memory.
//
// It also checks parity, and the parity check is the one that decides. A
// verdict that depends on which kernel ran is not deterministic, and
// determinism is the product.
import { readFileSync } from 'node:fs';
import { measureYiqDistance } from '../dist/difference/metric.js';
import { createField } from '../dist/difference/field.js';
import { differenceCurve } from '../dist/difference/curve.js';

const WIDTH = 1280;
const HEIGHT = 800;
const PIXELS = WIDTH * HEIGHT;

/** A page-like image: flat ground, cards, a block of noisy "text". */
function pageImage(seed) {
  const data = new Uint8Array(PIXELS * 4);
  let state = seed >>> 0;
  const next = () => ((state = (state * 1664525 + 1013904223) >>> 0) >>> 24);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const at = (y * WIDTH + x) * 4;
      let red, green, blue;
      if (y < 64) {
        red = 32; green = 34; blue = 40;
      } else if (y >= 640) {
        red = 245; green = 245; blue = 247;
      } else {
        const card = ((x >> 7) + (y >> 6)) & 1;
        red = card ? 255 : 250;
        green = card ? 255 : 250;
        blue = card ? 255 : 252;
        if (((y >> 2) & 3) === 0 && x > 100 && x < 900 && (next() & 7) < 3) {
          red = green = blue = 40 + (next() & 31);
        }
      }
      data[at] = red;
      data[at + 1] = green;
      data[at + 2] = blue;
      data[at + 3] = 255;
    }
  }
  return { width: WIDTH, height: HEIGHT, data, colorSpace: 'srgb', alphaMode: 'opaque' };
}

/** The same image with `fraction` of its rows shifted in every channel. */
function edited(image, fraction) {
  const data = new Uint8Array(image.data);
  const rows = Math.round(HEIGHT * fraction);
  for (let y = 100; y < 100 + rows; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const at = (y * WIDTH + x) * 4;
      data[at] = (data[at] + 37) & 255;
      data[at + 1] = (data[at + 1] + 11) & 255;
      data[at + 2] = (data[at + 2] + 73) & 255;
    }
  }
  return { ...image, data };
}

const wasm = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(new URL('./yiq-simd.wasm', import.meta.url))),
);
const { mem, yiq, yiqSkip } = wasm.exports;

const FIRST = 0;
const SECOND = 4 * PIXELS;
const OUT = 8 * PIXELS;
const NEEDED = OUT + 4 * PIXELS;
if (mem.buffer.byteLength < NEEDED) {
  mem.grow(Math.ceil((NEEDED - mem.buffer.byteLength) / 65536));
}

function load(first, second) {
  const heap = new Uint8Array(mem.buffer);
  heap.set(first.data, FIRST);
  heap.set(second.data, SECOND);
}
/** The copy back out, which is what a JS caller needs to read a value at all. */
function unload() {
  return new Float32Array(new Float32Array(mem.buffer, OUT, PIXELS));
}

function median(label, run, runs = 30) {
  for (let i = 0; i < 6; i += 1) run();
  const taken = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    run();
    taken.push(performance.now() - started);
  }
  taken.sort((left, right) => left - right);
  const p50 = taken[Math.floor(runs / 2)];
  console.log(`  ${label.padEnd(40)} ${p50.toFixed(2)} ms`);
  return p50;
}

// ---------------------------------------------------------------------------
// Parity: the whole 8-bit domain, not one screenshot's worth of it.
// ---------------------------------------------------------------------------
{
  const first = new Uint8Array(PIXELS * 4);
  const second = new Uint8Array(PIXELS * 4);
  let state = 12345 >>> 0;
  const next = () => ((state = (state * 1664525 + 1013904223) >>> 0) >>> 16) & 255;
  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    const at = pixel * 4;
    first[at] = next(); first[at + 1] = next(); first[at + 2] = next(); first[at + 3] = 255;
    second[at] = next(); second[at + 1] = next(); second[at + 2] = next(); second[at + 3] = 255;
  }
  const as = (data) => ({ width: WIDTH, height: HEIGHT, data, colorSpace: 'srgb', alphaMode: 'opaque' });

  load(as(first), as(second));
  yiq(FIRST, SECOND, OUT, PIXELS);
  const simd = unload();
  const js = measureYiqDistance(as(first), as(second)).values;

  const one = new Float32Array(1);
  const bits = new Int32Array(one.buffer);
  const bitsOf = (value) => { one[0] = value; return bits[0]; };

  let worstUlp = 0;
  let worstAbsolute = 0;
  for (let index = 0; index < PIXELS; index += 1) {
    const deviation = Math.abs(js[index] - simd[index]);
    if (deviation > worstAbsolute) worstAbsolute = deviation;
    if (js[index] !== simd[index]) {
      worstUlp = Math.max(worstUlp, Math.abs(bitsOf(js[index]) - bitsOf(simd[index])));
    }
  }

  const levels = [0, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.04, 0.09, 0.16, 0.25, 0.5, 0.75];
  const fromJs = differenceCurve(createField(WIDTH, HEIGHT, js), levels);
  const fromSimd = differenceCurve(createField(WIDTH, HEIGHT, simd), levels);
  let worstPoint = 0;
  let worstPointLevel = 0;
  for (let index = 0; index < levels.length; index += 1) {
    const apart = Math.abs(fromSimd[index].pixelCount - fromJs[index].pixelCount);
    if (apart > worstPoint) { worstPoint = apart; worstPointLevel = levels[index]; }
  }

  console.log(`parity over ${PIXELS.toLocaleString()} random opaque pairs`);
  console.log(`  worst deviation        ${worstAbsolute.toExponential(3)}`);
  console.log(`  worst f32 ulp distance ${worstUlp}`);
  console.log(`  worst curve point      ${worstPoint} pixel(s), at severity ${worstPointLevel}`);
  console.log(
    worstPoint === 0
      ? '  the two kernels agree on every level tested'
      : '  the two kernels disagree on a curve point, so they cannot both be in the tree',
  );
}

// ---------------------------------------------------------------------------
// Cost, across the regimes a real pair falls in.
// ---------------------------------------------------------------------------
const base = pageImage(1);
for (const fraction of [0, 0.05, 1]) {
  const other = fraction === 0 ? base : edited(base, fraction);
  console.log(`\n${WIDTH}x${HEIGHT}, ${(fraction * 100).toFixed(0)}% of the image changed`);

  const js = median('JS, as shipped', () => measureYiqDistance(base, other));
  load(base, other);
  const simd = median('SIMD, images already in wasm memory', () => yiq(FIRST, SECOND, OUT, PIXELS));
  const skipping = median('SIMD, skipping identical quads', () => yiqSkip(FIRST, SECOND, OUT, PIXELS));
  const copies = median('the copies alone', () => { load(base, other); unload(); });
  const whole = median('SIMD as a JS caller pays for it', () => {
    load(base, other);
    yiq(FIRST, SECOND, OUT, PIXELS);
    unload();
  });

  console.log(
    `    kernel ${(js / simd).toFixed(2)}x` +
      `   |   with the skip ${(js / skipping).toFixed(2)}x` +
      `   |   what a caller gets ${(js / whole).toFixed(2)}x` +
      `   |   copies are ${((100 * copies) / whole).toFixed(0)}% of it`,
  );
}
