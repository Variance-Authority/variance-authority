// Draws the glyphs the change image labels itself with, once, in Chromium.
//
// The change image is drawn without a browser, so its text comes from an atlas:
// each glyph of Inter at two weights, rendered here at 64 pixels and stored as a
// grey PNG whose value is coverage, with the advance and placement of each in a
// JSON file beside it. `@variance-authority/png` scales them down per sheet.
//
// Run it again only when the face, the weights or the characters change:
//   node tools/glyph-atlas.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const SIZE = 64;
const PAD = 6;
const WEIGHTS = { regular: 400, semibold: 600 };
const CHARACTERS = [
  ...Array.from({ length: 95 }, (_, at) => String.fromCharCode(32 + at)),
  '·', '–', '—', '…', '×', '→', '←',
].join('');

const root = new URL('../packages/png/glyphs/', import.meta.url);
const font = readFileSync(new URL('../packages/tribunal/fonts/inter.woff2', import.meta.url)).toString('base64');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const atlas = await page.evaluate(
    async ({ font, SIZE, PAD, WEIGHTS, CHARACTERS }) => {
      const face = new FontFace('Atlas', `url(data:font/woff2;base64,${font})`, { weight: '100 900' });
      document.fonts.add(await face.load());
      const out = {};
      for (const [name, weight] of Object.entries(WEIGHTS)) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const css = `${weight} ${SIZE}px Atlas`;
        context.font = css;
        const probe = context.measureText('Hg');
        const ascent = Math.ceil(probe.fontBoundingBoxAscent);
        const height = ascent + Math.ceil(probe.fontBoundingBoxDescent);
        const glyphs = [...CHARACTERS].map((character) => {
          const advance = context.measureText(character).width;
          return { character, advance, width: Math.ceil(advance) + 2 * PAD };
        });
        canvas.width = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
        canvas.height = height;
        context.font = css;
        context.fillStyle = '#000';
        context.textBaseline = 'alphabetic';
        let x = 0;
        for (const glyph of glyphs) {
          glyph.x = x;
          context.fillText(glyph.character, x + PAD, ascent);
          x += glyph.width;
        }
        const pixels = context.getImageData(0, 0, canvas.width, height).data;
        const alpha = Array.from({ length: canvas.width * height }, (_, at) => pixels[at * 4 + 3]);
        out[name] = { width: canvas.width, height, ascent, alpha, glyphs };
      }
      return out;
    },
    { font, SIZE, PAD, WEIGHTS, CHARACTERS },
  );

  mkdirSync(root, { recursive: true });
  const metrics = { size: SIZE, pad: PAD, weights: {} };
  for (const [name, { width, height, ascent, alpha, glyphs }] of Object.entries(atlas)) {
    const png = new PNG({ width, height, colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
    png.data = Buffer.from(alpha);
    writeFileSync(new URL(`inter-${name}.png`, root), PNG.sync.write(png, { colorType: 0, inputColorType: 0 }));
    metrics.weights[name] = {
      height,
      ascent,
      glyphs: Object.fromEntries(glyphs.map((glyph) => [glyph.character, [glyph.x, glyph.width, Math.round(glyph.advance * 100) / 100]])),
    };
  }
  writeFileSync(new URL('inter.json', root), `${JSON.stringify(metrics)}\n`);
  copyFileSync(new URL('../packages/tribunal/fonts/inter-LICENSE.txt', import.meta.url), new URL('inter-LICENSE.txt', root));
} finally {
  await browser.close();
}
