/**
 * `@variance-authority/png` — the only package that decodes an image.
 *
 * `pixelmatch` and `pngjs` are installed here and nowhere else, which is the
 * whole reason this is a package rather than a folder. A team extending their own
 * Playwright tests takes comparison, isolation and attribution and never renders
 * anything; a team whose images arrive from elsewhere takes only the reading end.
 * Neither should have to install a browser to do it, and with the codec in its own
 * box neither does.
 *
 * What is *not* here is the policy. A threshold and an antialiasing rule decide
 * verdicts and belong in a plan's identity, so they live in
 * `@variance-authority/raster` where they can be read, compared and hashed by a
 * caller who never opens a PNG.
 */

export {
  compareRasters,
  comparePngs,
  comparePixels,
  decode,
  diffImage,
  pngjsDecoder,
} from './compare.js';
export type { DecodedImage, PngDecoder } from './compare.js';

export { declaredIdentity, foreignDigest, foreignRaster } from './foreign.js';
export type { DeclaredPainter } from './foreign.js';
