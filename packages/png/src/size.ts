/**
 * The eight bytes of a PNG that say how big it is.
 *
 * Separate from {@link foreignRaster}, which answers the same question by
 * decoding the whole image. That is the right cost when the pixels are wanted
 * anyway; it is the wrong one when the caller only needs to know whether two
 * captures are the same shape. A full-page route capture is nine thousand rows,
 * and a push reads twenty of them.
 */

/** Where the IHDR puts them: signature, length, type, then the two numbers. */
const WIDTH_AT = 16;
const HEIGHT_AT = 20;
const HEADER = 24;
const SIGNATURE = 0x89504e47;

/**
 * How large a PNG says it is, or nothing.
 *
 * `null` rather than zeroes, and rather than a throw: the caller is deciding
 * whether it can *say* something about an image, and a zero would be a claim
 * about a raster nobody read. Bytes that are not a PNG, or are too short to
 * carry a header, are not a picture of size zero — they are a picture this
 * cannot measure, and every caller has somewhere honest to put that.
 */
export function pngSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  if (bytes.length < HEADER) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== SIGNATURE) return null;

  const width = view.getUint32(WIDTH_AT);
  const height = view.getUint32(HEIGHT_AT);
  // A PNG may not declare either dimension as zero, so a header that does is a
  // header this did not really read.
  return width > 0 && height > 0 ? { width, height } : null;
}
