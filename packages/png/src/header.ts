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
 * is a lossless WebP (see `keepImage`).
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
 * when a difference was accepted (see `keepImage`), and a baseline kept
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
