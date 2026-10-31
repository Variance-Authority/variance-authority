import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import type { DecodedImage } from './mask.js';
import { imageFormat, imageSize } from './header.js';

export { imageFormat, type ImageFormat } from './header.js';

/**
 * Decode either format without a native addon: PNG through `pngjs`, WebP
 * through libwebp compiled to WebAssembly (`@jsquash/webp`, a 135 KB module
 * compiled on the first WebP and never for a run that reads only PNGs).
 *
 * Bytes in neither format are refused by name. Handing them to `pngjs` would
 * report a CRC error about a file that was never a PNG.
 */
export async function decodePortable(bytes: Buffer): Promise<DecodedImage> {
  const format = imageFormat(bytes);
  if (format === 'png') return PNG.sync.read(bytes);
  if (format === 'webp') return decodeWebp(bytes);
  throw notAnImage(bytes);
}

function notAnImage(bytes: Uint8Array): Error {
  return new Error(
    `these ${bytes.length} bytes are neither a PNG nor a WebP: their header declares no image format.`,
  );
}

/**
 * The widest and tallest image a WebP can hold: its header spends fourteen bits
 * on each side.
 */
export const KEEP_LIMIT = 16_383;

/**
 * Turn an accepted capture into the bytes a store keeps: a lossless WebP that
 * decodes to every channel of every pixel the capture held, checked by decoding
 * it back before it is returned.
 *
 * It runs once per accepted difference, never on a comparison, so a run that
 * changes nothing encodes nothing. A WebP is returned as it came; an image
 * beyond {@link KEEP_LIMIT} on a side is refused before any pixel is decoded.
 */
export async function keepImage(bytes: Buffer): Promise<Buffer> {
  const format = imageFormat(bytes);
  if (format === 'webp') return bytes;
  if (format !== 'png') throw notAnImage(bytes);

  const size = imageSize(bytes);
  if (size !== null && (size.width > KEEP_LIMIT || size.height > KEEP_LIMIT)) {
    throw new Error(
      `a ${size.width}x${size.height} image cannot be kept: a WebP holds at most ` +
        `${KEEP_LIMIT} pixels on a side. Capture a smaller viewport or clip the page.`,
    );
  }

  const source = PNG.sync.read(bytes);
  const encode = await webpEncode();
  const kept = Buffer.from(
    await encode(
      {
        data: new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.byteLength),
        width: source.width,
        height: source.height,
      },
      // The fastest method at the quality where it starts to pay: it halves a
      // full-page PNG in about the time pngjs takes to decode one. `exact` keeps
      // the colour under a fully transparent pixel, which the comparison reads.
      { lossless: 1, exact: 1, method: 0, quality: 75 },
    ),
  );

  // The only proof the kept bytes are the accepted pixels: a store that kept
  // anything else would make every later verdict about a picture nobody approved.
  const back = await decodeWebp(kept);
  if (back.width !== source.width || back.height !== source.height || !Buffer.from(back.data.buffer, back.data.byteOffset, back.data.byteLength).equals(source.data)) {
    throw new Error(
      `the WebP encoder returned a ${back.width}x${back.height} image that does not decode to the ` +
        `${source.width}x${source.height} capture it was given; nothing was kept.`,
    );
  }
  return kept;
}

type Pixels = { width: number; height: number; data: Uint8ClampedArray };
type WebpDecode = (buffer: ArrayBuffer) => Promise<Pixels>;
type WebpEncode = (image: Pixels, options: Record<string, number>) => Promise<ArrayBuffer>;

/**
 * Each half is compiled once per process, on first use, from the file beside
 * its loader rather than fetched — fetching is what the package does by default and
 * what Node cannot do from a `file:` URL. A comparison only ever decodes, so it
 * never compiles the encoder. The encoder is the SIMD build: every Node this
 * supports runs WebAssembly SIMD, and the scalar build is the slower half.
 */
let decoder: Promise<WebpDecode> | undefined;
let encoder: Promise<WebpEncode> | undefined;

function webpDecode(): Promise<WebpDecode> {
  decoder ??= (async () => {
    const module = await import('@jsquash/webp/decode.js');
    await module.init({ wasmBinary: await wasm('@jsquash/webp/codec/dec/webp_dec.wasm') });
    return module.default as WebpDecode;
  })();
  return decoder;
}

function webpEncode(): Promise<WebpEncode> {
  encoder ??= (async () => {
    const module = await import('@jsquash/webp/encode.js');
    await module.init({ wasmBinary: await wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm') });
    return module.default as WebpEncode;
  })();
  return encoder;
}

/** The module's bytes, handed to emscripten as `wasmBinary` so it never fetches. */
async function wasm(specifier: string): Promise<Uint8Array> {
  return readFile(createRequire(import.meta.url).resolve(specifier));
}

async function decodeWebp(bytes: Buffer): Promise<DecodedImage> {
  const decode = await webpDecode();
  // A copy, not a view: the decoder takes an ArrayBuffer, and a Buffer's
  // backing store is a pool shared with every other small Buffer.
  const image = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return {
    width: image.width,
    height: image.height,
    data: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  };
}
