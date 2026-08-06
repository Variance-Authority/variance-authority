/**
 * Freeze an animated GIF by *truncating* it, before the browser ever decodes it.
 *
 * ## Why a GIF is the hardest of the easy cases
 *
 * A GIF has been animating since it decoded. No CSS reaches it — `animation-*`
 * governs CSS animations and a GIF is not one — so the trick that pins every
 * keyframe on the page leaves a spinning logo spinning, and two runs a second
 * apart read two different images.
 *
 * Argos solves this in the page, and the design is careful: construct a *fresh*
 * `Image`, draw it to a canvas, take `toDataURL('image/png')` as frame zero, and
 * swap it into `src`. Fresh, because the `<img>` already on the page has been
 * animating since load and there is no way to seek it back. It works, and it has
 * a failure mode its own documentation states — a cross-origin image without
 * CORS taints the canvas, `toDataURL` throws, and the GIF is left animating.
 *
 * ## Why doing it on the wire is strictly better
 *
 * Intercept the response and the problem changes shape. The bytes have not been
 * decoded yet, so there is no animation to seek back to zero and no second
 * decode to pay for. **Cross-origin stops mattering**, because the fulfilment is
 * ours: a canvas is tainted by what the page may read, and nothing here asks a
 * page to read anything. And the result is the original bytes minus some of
 * them, so the palette, the transparency, the dimensions and the compression are
 * exactly what the author shipped — where a canvas round-trip re-encodes through
 * RGBA and produces a PNG that is a different image from the one under test.
 *
 * ## What the truncation actually is
 *
 * A single-frame GIF is a valid GIF, and it is a prefix of the animated one.
 * The format is a header, a screen descriptor, an optional global colour table,
 * and then a stream of blocks — extensions, image descriptors — ending in a
 * trailer. Keep everything up to and including the **first image descriptor and
 * its pixel data**, append the trailer byte, and the file is complete and
 * static. No decoder, no encoder, no dependency, and no re-encoding.
 *
 * This is the whole reason it lives in a package that requires a browser rather
 * than one that requires an image codec: it does not need one.
 *
 * @see https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */

const HEADER_LENGTH = 6;
const SCREEN_DESCRIPTOR_LENGTH = 7;
const TRAILER = 0x3b;
const EXTENSION_INTRODUCER = 0x21;
const IMAGE_SEPARATOR = 0x2c;
const IMAGE_DESCRIPTOR_LENGTH = 9;

/**
 * The first frame of a GIF, as a GIF — or `null` when there is nothing to do.
 *
 * `null` for anything this cannot honestly improve: bytes that are not a GIF,
 * bytes that are a GIF with one frame already, and bytes it could not parse.
 * Three different reasons for the same answer, because the caller's move is the
 * same in all three — pass the response through untouched — and inventing an
 * output for a file we did not understand is how a stabilizer corrupts an asset.
 *
 * Never throws. This runs inside a request handler, and a stabilizer that can
 * take down a page load is worse than the flake it prevents.
 */
export function freezeGif(bytes: Uint8Array): Uint8Array | null {
  try {
    return truncate(bytes);
  } catch {
    // A malformed GIF is the browser's problem to render, not ours to repair.
    return null;
  }
}

function truncate(bytes: Uint8Array): Uint8Array | null {
  if (!isGif(bytes)) return null;

  let at = HEADER_LENGTH;

  const packed = byteAt(bytes, at + 4);
  at += SCREEN_DESCRIPTOR_LENGTH;
  // Bit 7 of the packed field is the global colour table flag; bits 0-2 are its
  // size as `2^(N+1)` entries of three bytes each.
  if ((packed & 0b1000_0000) !== 0) at += 3 * 2 ** ((packed & 0b0000_0111) + 1);

  let firstFrameEnd: number | undefined;

  while (at < bytes.length) {
    const marker = byteAt(bytes, at);

    if (marker === TRAILER) break;

    if (marker === EXTENSION_INTRODUCER) {
      // Introducer, label, then sub-blocks. Extensions before the first image
      // are kept: a graphic control extension carries the transparency index,
      // and dropping it turns a transparent GIF opaque.
      at = endOfSubBlocks(bytes, at + 2);
      continue;
    }

    if (marker === IMAGE_SEPARATOR) {
      at += 1 + IMAGE_DESCRIPTOR_LENGTH;
      const local = byteAt(bytes, at - 1);
      if ((local & 0b1000_0000) !== 0) at += 3 * 2 ** ((local & 0b0000_0111) + 1);
      // One byte of LZW minimum code size, then the compressed sub-blocks.
      at = endOfSubBlocks(bytes, at + 1);

      firstFrameEnd = at;

      // One frame is all that needs parsing. Walking the rest would decode an
      // entire animation to learn something the very next byte answers, on
      // every image of every subject of every run.
      break;
    }

    // A block this does not recognise means the parse has lost its place, and a
    // truncation from a position we cannot vouch for is a corrupt image.
    return null;
  }

  if (firstFrameEnd === undefined) return null;

  // Already static: everything after the first frame is the trailer. Returning
  // `null` keeps "we changed nothing" and "we rewrote it identically" distinct,
  // which is what lets the caller report only the images it actually froze.
  if (!hasMoreFrames(bytes, firstFrameEnd)) return null;

  const frozen = new Uint8Array(firstFrameEnd + 1);
  frozen.set(bytes.subarray(0, firstFrameEnd));
  frozen[firstFrameEnd] = TRAILER;

  return frozen;
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_LENGTH + SCREEN_DESCRIPTOR_LENGTH) return false;
  // `GIF87a` or `GIF89a`. Only 89a can animate, and refusing 87a on that basis
  // would be a second way to be wrong about a file whose own blocks answer the
  // question — an 87a with one frame falls out as `null` anyway.
  return (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && bytes[5] === 0x61
  );
}

/**
 * Whether another block follows the first frame.
 *
 * One byte, not a scan. GIF is strictly block-structured: what follows a
 * sub-block terminator is the next block's marker or the trailer, never
 * padding — so scanning forward for a marker byte would find one inside
 * whatever trailing junk an encoder left and rewrite a file that was already
 * static. A missing trailer counts as *no more frames* for the same reason
 * every other unparseable case does: we did not understand it, so we do not
 * touch it.
 */
function hasMoreFrames(bytes: Uint8Array, from: number): boolean {
  const next = bytes[from];
  return next === EXTENSION_INTRODUCER || next === IMAGE_SEPARATOR;
}

/**
 * Walk a chain of length-prefixed sub-blocks to the terminator.
 *
 * The one loop that can run away on malformed input, so it is the one that
 * checks: a length running past the end of the buffer throws, which
 * {@link freezeGif} turns into "pass it through untouched".
 */
function endOfSubBlocks(bytes: Uint8Array, from: number): number {
  let at = from;
  while (at < bytes.length) {
    const length = byteAt(bytes, at);
    if (length === 0) return at + 1;
    at += 1 + length;
  }
  throw new Error('sub-block chain ran past the end of the file');
}

function byteAt(bytes: Uint8Array, at: number): number {
  const byte = bytes[at];
  if (byte === undefined) throw new Error(`read past the end of the file at ${at}`);
  return byte;
}
