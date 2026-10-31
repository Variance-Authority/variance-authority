/**
 * The few bytes of an image that say what it is and how big it is, read
 * without a codec: a worker serving stored images needs the answer and none of
 * the decoder.
 *
 * Separate from {@link foreignRaster}, which answers the same question by
 * decoding the whole image. That is the right cost when the pixels are wanted
 * anyway; it is the wrong one when the caller only needs to know whether two
 * captures are the same shape. A full-page route capture is nine thousand rows,
 * and a push reads twenty of them.
 *
 * The two formats this package reads: a capture is a PNG, and a kept baseline
 * is a lossless WebP (see {@link refuseUnkept}).
 */

type Size = { readonly width: number; readonly height: number };

/**
 * How large a PNG or a WebP says it is, or nothing.
 *
 * `null` rather than zeroes, and rather than a throw: the caller is deciding
 * whether it can *say* something about an image, and a zero would be a claim
 * about a raster nobody read. Bytes in neither format, or too short to carry a
 * header, are not a picture of size zero — they are a picture this cannot
 * measure, and every caller has somewhere honest to put that.
 */
export function imageSize(bytes: Uint8Array): Size | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = pngSize(view) ?? webpSize(view);
  // Neither format may declare a dimension of zero, so a header that does is a
  // header this did not really read.
  return size !== null && size.width > 0 && size.height > 0 ? size : null;
}

/** Signature, then the IHDR length and type, then width and height. */
function pngSize(view: DataView): Size | null {
  if (view.byteLength < 24 || view.getUint32(0) !== PNG) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** `RIFF`, a four-byte length, then `WEBP`. */
const RIFF = 0x52494646;
const WEBP = 0x57454250;
const VP8L = 0x5650384c;
const VP8X = 0x56503858;
const VP8 = 0x56503820;

/**
 * `RIFF`, a length, `WEBP`, then the first chunk: a lossless bitstream packs
 * each side minus one into fourteen bits after its signature byte, and an
 * extended file stores its canvas minus one in three bytes each. Lossy WebP is
 * not read: nothing this package keeps is lossy.
 */
function webpSize(view: DataView): Size | null {
  if (view.byteLength < 30 || view.getUint32(0) !== RIFF || view.getUint32(8) !== WEBP) return null;
  const chunk = view.getUint32(12);
  if (chunk === VP8L && view.getUint8(20) === 0x2f) {
    const packed = view.getUint32(21, true);
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === VP8X) {
    const triple = (at: number): number => view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
    return { width: triple(24) + 1, height: triple(27) + 1 };
  }
  return null;
}

/**
 * The two formats an image arrives in, read from its own first bytes.
 *
 * A capture is a PNG, because that is what a browser hands over and what the
 * comparison reads fastest. A kept baseline is a lossless WebP, encoded once
 * when a difference was accepted (see {@link refuseUnkept}), and a baseline kept
 * before that is a PNG. Both reach a comparison as bytes, and the
 * header is the format's own declaration of what they are, so nothing beside
 * the bytes has to travel with them through a wire or a bucket.
 */
export type ImageFormat = 'png' | 'webp';

/** The format the bytes declare, or `null` when they declare neither. */
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength >= 8 && view.getUint32(0) === PNG && view.getUint32(4) === PNG_TAIL) return 'png';
  if (view.byteLength >= 12 && view.getUint32(0) === RIFF && view.getUint32(8) === WEBP) return 'webp';
  return null;
}

/** The PNG signature: `\x89PNG`, then `\r\n\x1a\n`. */
const PNG = 0x89504e47;
const PNG_TAIL = 0x0d0a1a0a;

/**
 * Whether a WebP carries a lossless bitstream and no lossy one.
 *
 * Read from the chunks, not the first one alone: an extended file opens with
 * `VP8X`, and its bitstream comes after any metadata. A lossy `VP8 ` chunk
 * anywhere means pixels the encoder approximated, which no store may keep.
 */
export function isLosslessWebp(bytes: Uint8Array): boolean {
  if (imageFormat(bytes) !== 'webp') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let lossless = false;
  for (let at = 12; at + 8 <= view.byteLength; ) {
    const chunk = view.getUint32(at);
    if (chunk === VP8) return false;
    if (chunk === VP8L) lossless = true;
    // Each chunk's payload is padded to an even length.
    const size = view.getUint32(at + 4, true);
    at += 8 + size + (size % 2);
  }
  return lossless;
}

/**
 * Refuse bytes a store must not keep: anything but a lossless WebP no wider or
 * taller than {@link KEEP_LIMIT}. Read from the header alone, so a store checks
 * what it is handed without a codec.
 *
 * Encoding is the caller's, before it hands the image over, so the store never
 * runs a codec on a write and a remote store receives the bytes it keeps.
 */
export function refuseUnkept(bytes: Uint8Array): void {
  if (!isLosslessWebp(bytes)) {
    const format = imageFormat(bytes);
    throw new Error(
      `a store keeps a lossless WebP, and these ${bytes.length} bytes are ` +
        `${format === 'webp' ? 'a lossy WebP' : format === 'png' ? 'a PNG' : 'neither a PNG nor a WebP'}.`,
    );
  }
  refuseOversize(bytes);
}

/**
 * The widest and tallest image a WebP can hold: its header spends fourteen bits
 * on each side.
 */
export const KEEP_LIMIT = 16_383;

/** Refuse an image larger on a side than a WebP can hold, by the size its header declares. */
export function refuseOversize(bytes: Uint8Array): void {
  const size = imageSize(bytes);
  if (size !== null && (size.width > KEEP_LIMIT || size.height > KEEP_LIMIT)) {
    throw new Error(
      `a ${size.width}x${size.height} image cannot be kept: a WebP holds at most ` +
        `${KEEP_LIMIT} pixels on a side. Capture a smaller viewport or clip the page.`,
    );
  }
}
