// Regenerates the two tables in ../README.md.
//
//   node node_modules/@variance-authority/png-sharp/scripts/bench.mjs
//   UV_THREADPOOL_SIZE=12 node node_modules/@variance-authority/png-sharp/scripts/bench.mjs
//
// The concurrency arm is why the pool size matters: libvips decodes on libuv's
// threadpool, and libuv reads UV_THREADPOOL_SIZE once, before the pool is first
// used. It cannot be set from inside the package, so it is set on the command
// line and reported beside the result.
import { pngjsDecoder } from '@variance-authority/png';
import sharp from 'sharp';

const WIDTH = 1280;
const HEIGHT = 800;
const COUNT = 32;

/** A page-like image: flat ground, a few bands, a block of noisy "text". */
function pageBytes(seed) {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  let x = seed * 2654435761;
  const next = () => ((x = (x * 1664525 + 1013904223) >>> 0) >>> 24);
  for (let y = 0; y < HEIGHT; y += 1) {
    const band = y > 120 && y < 180 ? 40 : 0;
    for (let px = 0; px < WIDTH; px += 1) {
      const i = (y * WIDTH + px) * 4;
      const text = y > 240 && y < 700 && px > 80 && px < 1200 && next() > 200;
      const v = text ? 30 + (next() % 40) : 250 - band - (px >> 7);
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v + (seed % 5);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const images = await Promise.all(
  Array.from({ length: COUNT }, (_, i) =>
    sharp(pageBytes(i + 1), { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
      .png()
      .toBuffer(),
  ),
);

const decodeSharp = (png) => sharp(png).raw().toBuffer();
const decodePngjs = async (png) => Buffer.from((await pngjsDecoder.decode(png)).data);

// Every candidate must agree with pngjs's RGBA before it is timed.
{
  const [a, b] = [await decodeSharp(images[0]), await decodePngjs(images[0])];
  if (!a.equals(b)) throw new Error('sharp and pngjs disagree; the timings would be meaningless');
}

async function time(label, run) {
  await run(); // warm the addon, the JIT and the page cache
  const start = process.hrtime.bigint();
  await run();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { label, perImage: ms / COUNT };
}

const sequential = async (decode) => {
  for (const png of images) await decode(png);
};
const concurrent = async (decode) => {
  await Promise.all(images.map(decode));
};

const pool = process.env.UV_THREADPOOL_SIZE ?? '4 (default)';
const rows = [
  await time(`\`Promise.all\`, pool of ${pool}`, () => concurrent(decodeSharp)),
  await time('one at a time', () => sequential(decodeSharp)),
  await time('`pngjs`, one at a time', () => sequential(decodePngjs)),
];

const kb = Math.round(images.reduce((n, b) => n + b.length, 0) / images.length / 1024);
console.log(`${COUNT} images, ${WIDTH}×${HEIGHT}, ~${kb} KiB each, one process`);
console.log(`node ${process.version}, sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}`);
console.log();
for (const { label, perImage } of rows) console.log(`| ${label} | ${perImage.toFixed(1)} ms |`);
const [fastest] = [...rows].sort((a, b) => a.perImage - b.perImage);
const [slowest] = [...rows].sort((a, b) => b.perImage - a.perImage);
console.log();
console.log(`spread: ${(slowest.perImage / fastest.perImage).toFixed(1)}×`);
console.log(
  'reproduce: UV_THREADPOOL_SIZE=12 ' +
    'node node_modules/@variance-authority/png-sharp/scripts/bench.mjs',
);
