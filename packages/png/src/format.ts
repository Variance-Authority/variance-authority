import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import type { DecodedImage } from './mask.js';
import { imageFormat } from './header.js';

export { imageFormat, type ImageFormat } from './header.js';

/**
 * Decode either format without a native addon: PNG through `pngjs`, WebP
 * through libwebp compiled to WebAssembly (`@jsquash/webp`, a 135 KB module
 * compiled on the first WebP and never for a run that reads only PNGs). Wasm
 * decodes a full-page WebP in 12.8 ms, where `pngjs` takes 77.4 ms for the same
 * page as a PNG (#860).
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

type Pixels = { width: number; height: number; data: Uint8ClampedArray };
type WebpDecode = (buffer: ArrayBuffer) => Promise<Pixels>;

/**
 * Compiled once per process, on first use, from the file beside its loader
 * rather than fetched — fetching is what the package does by default and what
 * Node cannot do from a `file:` URL. Only the decoder: nothing here encodes,
 * because encoding is native and runs where the accept runs (`keepImage` in
 * `@variance-authority/png-sharp`).
 */
let decoder: Promise<WebpDecode> | undefined;

function webpDecode(): Promise<WebpDecode> {
  decoder ??= (async () => {
    const module = await import('@jsquash/webp/decode.js');
    await module.init({ wasmBinary: await wasm('@jsquash/webp/codec/dec/webp_dec.wasm') });
    return module.default as WebpDecode;
  })();
  return decoder;
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
