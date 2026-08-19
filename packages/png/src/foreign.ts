import { digestBytes, type Digest, type Raster, type RenderIdentity } from '@variance-authority/core';
import { PNG } from 'pngjs';

/**
 * An image this system did not paint, given the smallest identity that can still
 * be compared.
 *
 * The resulting raster can answer whether pixels changed under the same declared
 * painter. It cannot recover provenance, bands, causes, snapshots, or render-
 * cache settlement from image bytes; callers receive only the evidence they
 * supply alongside it. This is a low-level library seam, not a CLI ingest flow.
 *
 * ## The two fields that are not obvious
 *
 * **`documentDigest` is the digest of the image's own bytes.** Everywhere else
 * in this system that field is the digest of the document a renderer was handed,
 * and the whole settlement economy rests on it: identical documents cannot paint
 * different images, so a digest match settles a subject without decoding
 * anything. A foreign PNG has no document — but it does not *need* the
 * indirection, because the image is the entire artifact. There is nothing behind
 * it that could have differed while the bytes matched, which is a stronger
 * guarantee than the document digest gives, not a weaker one. (It is stronger in
 * exactly the way that is useless: it can never settle a subject one render
 * earlier, because there is no render to skip.)
 *
 * **`identity` is a declaration.** Nothing here can inspect a GPU or a font
 * stack, so the operator names the thing that produced these images and that
 * name is compared like any other identity. A declaration that changes makes the
 * next run `incomparable` rather than a wall of red — the one property of the
 * durable mode that transfers wholesale, and the reason the flag is required
 * rather than defaulted. An operator who will not name their painter is an
 * operator whose baselines cannot tell a driver upgrade from a regression, and
 * this refuses to make that choice for them.
 */

/** What an operator can say about a painter this process never saw. */
export interface DeclaredPainter {
  /**
   * A name the operator chooses and keeps: `playwright-webkit@1.49`,
   * `ios-simulator-17.4`, `figma-export`.
   *
   * Free text, because there is nothing to validate it against. Its whole job is
   * to be *the same string* for images that are comparable and a *different*
   * string for images that are not, which is a judgement only the operator can
   * make.
   */
  readonly painter: string;
  /**
   * Device pixels per CSS pixel, when the operator knows it.
   *
   * Recorded rather than derived, and defaulted to 1 rather than guessed from
   * the image width, because dividing pixels by an assumed viewport is how a 2×
   * capture and a 1× capture of a wider page become the same identity.
   */
  readonly scale?: number;
}

/**
 * The identity a declared painter stands for.
 *
 * `engine` and `platform` carry the declaration too, spelled so that a sidecar
 * read by a person says where the value came from. They are not padding: every
 * field of `RenderIdentity` is folded into `identityDigest`, so a blank here
 * would put every declared painter in one partition with every other tool's, and
 * two operators sharing a store would compare each other's screenshots.
 */
export function declaredIdentity(declaration: DeclaredPainter): RenderIdentity {
  return {
    renderer: `declared:${declaration.painter}`,
    engine: `declared:${declaration.painter}`,
    platform: `declared:${declaration.painter}`,
    deviceScaleFactor: declaration.scale ?? 1,
    // Empty, and it means *nothing is known*, which is why `missingFonts` below
    // is also empty. A font list invented here would be a claim about a machine
    // this process has never seen, and the one thing worse than not knowing
    // whether a font substituted is a record saying it did not.
    fonts: [],
  };
}

/**
 * PNG bytes become a {@link Raster} under a declared identity.
 *
 * Dimensions are read from the image rather than taken from the caller, because
 * they are the one physical fact the bytes actually contain — and a comparison
 * pads to the union box, so a wrong height here would silently shift every
 * region's coordinates. `pngjs` reads the whole image to answer a question the
 * 8-byte IHDR could answer, which is a cost worth paying once per ingested file
 * to avoid a second, hand-rolled PNG parser in a repository that already has
 * one.
 *
 * No `components`, and that is load-bearing rather than an omission. `undefined`
 * means *unknown* everywhere it is read, so a foreign baseline is never selected
 * against by `--since` and never absorbed by a sensitivity level: both mechanisms
 * treat an absent list as "this could have changed" and observe it. An empty
 * array would mean *this renders nothing*, and would quietly stop watching every
 * image that entered this way.
 */
export function foreignRaster(bytes: Buffer, declaration: DeclaredPainter): Raster {
  const png = PNG.sync.read(bytes);

  return {
    documentDigest: foreignDigest(bytes),
    identity: declaredIdentity(declaration),
    width: png.width,
    height: png.height,
    bytes: bytes.toString('base64'),
    missingFonts: [],
  };
}

/** The image's own bytes as its document digest. See the note above. */
export function foreignDigest(bytes: Buffer): Digest {
  return digestBytes(bytes);
}
