import { deflateSync } from 'node:zlib';
import { matchesGlob } from '@variance-authority/core/judge';

/**
 * Serve an image as *nothing*, at exactly the size it would have been.
 *
 * ## What this is for
 *
 * A page's images are not all part of what a visual test is asserting. A hero
 * photograph rotated by a CMS, an avatar served from a third party, a marketing
 * illustration re-exported at a new compression — each repaints a large area,
 * none of them is a regression, and every one of them is indistinguishable from
 * a regression once it reaches the pixels. The industry answer is a mask drawn
 * over the region afterwards, and it is the wrong shape in three separate ways:
 * the bytes are still fetched, the *layout* still moves when the new image has
 * different dimensions, and the environment key still changes, so the run
 * re-renders every subject the image appears on to discover it need not have.
 *
 * Blanking answers all three at once, on the wire, before the browser has
 * decoded anything: the response is replaced with a fully transparent image of
 * **the original's intrinsic dimensions**, so every box on the page resolves
 * exactly as it would have, and the asset is recorded in the environment key as
 * *the blank it became* rather than as the bytes it was.
 *
 * ## Why the dimensions are the whole difficulty
 *
 * A one-pixel transparent PNG is trivial to serve and destroys the page. An
 * `<img>` with no width in CSS lays out at its intrinsic size, so replacing a
 * 1200×600 banner with a 1×1 collapses the column it was holding open, and the
 * run then reports a layout regression that this tool caused. So the size is
 * read out of the original bytes first, and a format whose header this cannot
 * read is **served unmodified with a diagnostic** rather than blanked at a
 * guessed size. Refusing is cheap; a fabricated layout is a red run nobody can
 * explain.
 *
 * ## Transparent, not grey
 *
 * What is left is the page's own background, which is the honest rendering of
 * "there is nothing here". A flat fill would be a second thing to compare — and
 * would silently change the contrast under any text sitting on top, which the
 * accessibility rules would then report as a defect of the page rather than of
 * the substitution. One consequence to know: a contrast finding over a blanked
 * image is measured against whatever is *behind* the image.
 *
 * ## What it cannot see
 *
 * A request carries no idea which element wanted it. `role="presentation"`,
 * `alt=""`, a selector, a rendered box — none of those exists at this layer, and
 * no amount of care here will produce them. Those are decided in the page, by
 * the collector, against the DOM; this file decides the half that is a fact
 * about the bytes and the URL. The split is not a limitation to be worked around
 * later, it is where the two kinds of knowledge actually live.
 */

/**
 * One reason to blank, and what it applies to.
 *
 * Every matcher present must hold. A rule that names **no** matcher is refused
 * by {@link blankRuleError} rather than treated as "everything": a config that
 * blanks every image on the site is a legitimate thing to want and an illegitimate
 * thing to arrive at by leaving a field out.
 */
export interface BlankRule {
  /** Names this rule in the ledger and in the environment key. */
  readonly id: string;

  /**
   * Why these images are not the subject. Optional here, required in a config.
   *
   * The asymmetry is deliberate and matches `ignore`. A library caller composing
   * this by hand has their reason in the code that composed it; an operator
   * writing a rule into a file that outlives them does not, and six months later
   * the only question anyone asks is whether it is still true. A rule that cannot
   * answer gets kept out of superstition.
   */
  readonly reason?: string;

  /** Glob over the request URL: `**\/hero/**`, `https://cdn.example/**`. */
  readonly url?: string;

  /**
   * Intrinsic `width × height`, at or above which this rule applies.
   *
   * Intrinsic rather than rendered, because rendered is a DOM fact and this is
   * not the DOM. The two differ, and the direction they differ in is safe: an
   * image displayed small but shipped large is still a large *download* whose
   * bytes still move under a CDN, so treating it by what was sent is the more
   * conservative reading.
   */
  readonly minPixels?: number;

  /**
   * Intrinsic `width × height`, at or below which this rule applies.
   *
   * The upper bound exists so the lower one can be used without qualification.
   * A chevron, a checkmark, a status dot — small images that carry the meaning a
   * layout assertion is *about* — are kept by never matching a `minPixels` rule,
   * and this is here for the opposite policy, where a project wants its icon set
   * pinned and its photography ignored.
   */
  readonly maxPixels?: number;
}

/** Intrinsic dimensions, in image pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Why a rule list is unusable, or `null`.
 *
 * Returned rather than thrown so the caller decides whether an unusable rule is
 * an operator error at config time or a diagnostic at run time. Both callers
 * exist.
 */
export function blankRuleError(rules: readonly BlankRule[]): string | null {
  const seen = new Set<string>();

  for (const rule of rules) {
    if (rule.id === '') return 'a blank rule needs an id; the ledger and the environment key name it';
    if (seen.has(rule.id)) {
      return `two blank rules are both called \`${rule.id}\`; a ledger cannot say which one absorbed what`;
    }
    seen.add(rule.id);

    if (rule.url === undefined && rule.minPixels === undefined && rule.maxPixels === undefined) {
      return (
        `blank rule \`${rule.id}\` names nothing, so it would blank every image on the page. ` +
        'That is a real policy and it has to be written down as one — give it `url: "**"`'
      );
    }

    if (
      rule.minPixels !== undefined &&
      rule.maxPixels !== undefined &&
      rule.minPixels > rule.maxPixels
    ) {
      return (
        `blank rule \`${rule.id}\` asks for at least ${rule.minPixels} and at most ` +
        `${rule.maxPixels} pixels, which no image can satisfy`
      );
    }
  }

  return null;
}

/** The first rule that applies to this image, or `null`. */
export function blankRuleFor(
  rules: readonly BlankRule[],
  url: string,
  size: ImageSize,
): BlankRule | null {
  const area = size.width * size.height;

  return (
    rules.find(
      (rule) =>
        (rule.url === undefined || matchesGlob(url, rule.url)) &&
        (rule.minPixels === undefined || area >= rule.minPixels) &&
        (rule.maxPixels === undefined || area <= rule.maxPixels),
    ) ?? null
  );
}

/**
 * Whether any rule names this URL, ignoring size.
 *
 * For the one case where a rule *looks* applied and is not: an image whose
 * header this cannot measure. Size-only rules are excluded deliberately — a
 * `minPixels` rule that skipped an unmeasurable SVG has behaved exactly as
 * written, and warning about it on every page would bury the case where an
 * operator aimed a path at a file and nothing happened.
 */
export function blankUrlAimedAt(rules: readonly BlankRule[], url: string): boolean {
  return rules.some((rule) => rule.url !== undefined && matchesGlob(url, rule.url));
}

/**
 * What the environment key records for a blanked asset.
 *
 * **The dimensions are in it, and leaving them out would be a false
 * `unchanged`.** The whole saving of blanking is that a changed illustration no
 * longer moves the key — but a *resized* illustration moves the layout, and a
 * key that said only `blank:illustrations` would settle every subject it appears
 * on without rendering, against a page whose columns have shifted. So the value
 * carries exactly what survived the substitution: which rule did it, and what
 * size the box still is.
 */
export function blankKey(rule: BlankRule, size: ImageSize): string {
  return `blank:${rule.id}:${size.width}x${size.height}`;
}

/**
 * Intrinsic dimensions from a container header, or `null` for a format this does
 * not read.
 *
 * Headers only — no decoder, no dependency, in the same spirit as
 * [`gif.ts`](gif.ts) and for the same reason: this package is defined by
 * requiring a browser, and acquiring an image codec to read four integers would
 * make every consumer of it pay for one.
 *
 * SVG is `null` on purpose rather than by omission. An SVG's intrinsic size is a
 * function of `width`, `height`, `viewBox` and the box it is placed in, and the
 * cases where all three disagree are exactly the cases where guessing wrong
 * moves the layout. AVIF and JPEG 2000 are `null` because reading them means
 * walking an ISO-BMFF box tree, which is a decoder by another name.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return pngSize(view) ?? gifSize(view) ?? webpSize(view) ?? jpegSize(view);
}

function pngSize(bytes: Buffer): ImageSize | null {
  // Signature, then the IHDR length and type, then width and height.
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 10 || bytes.toString('ascii', 0, 3) !== 'GIF') return null;
  // The *logical screen* descriptor, which is the size the browser lays out at
  // — a frame may be smaller and positioned within it.
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function webpSize(bytes: Buffer): ImageSize | null {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const chunk = bytes.toString('ascii', 12, 16);

  // Extended: a canvas size, stored minus one, three bytes each.
  if (chunk === 'VP8X') {
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  }

  // Lossy: the keyframe header, after the three-byte start code.
  if (chunk === 'VP8 ') {
    const start = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (start < 0 || start + 7 > bytes.length) return null;
    return {
      width: bytes.readUInt16LE(start + 3) & 0x3fff,
      height: bytes.readUInt16LE(start + 5) & 0x3fff,
    };
  }

  // Lossless: fourteen bits each, minus one, packed after the signature byte.
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const packed = bytes.readUInt32LE(21);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

function jpegSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;

    const marker = bytes[offset + 1] ?? 0;
    // Every start-of-frame carries the dimensions, and there are sixteen of
    // them; the three exceptions in the range are tables and restart intervals.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }

    offset += 2 + bytes.readUInt16BE(offset + 2);
  }

  return null;
}

/**
 * A fully transparent PNG of exactly these dimensions.
 *
 * One-bit palette rather than 8-bit RGBA, which is not a micro-optimization: a
 * 2000×2000 RGBA canvas is sixteen megabytes of zeroes to allocate and hand to
 * `deflate` for every blanked image on every subject, and the same picture as a
 * one-bit palette is half a megabyte. Both compress to nothing; only one of them
 * has to exist in memory first.
 *
 * Transparency comes from `tRNS` giving the single palette entry an alpha of
 * zero, which is the smallest legal way to say "none of this is there".
 */
export function blankPng(width: number, height: number): Buffer {
  const stride = Math.ceil(width / 8);
  // One filter byte per row, then the row's packed bits — all zero, which is
  // filter type `None` and palette index 0 for every pixel.
  const raw = Buffer.alloc(height * (stride + 1));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr(width, height)),
    chunk('PLTE', Buffer.from([0, 0, 0])),
    chunk('tRNS', Buffer.from([0])),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ihdr(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(1, 8); // bit depth: one bit per pixel
  header.writeUInt8(3, 9); // colour type: palette
  return header;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');

  const crc = Buffer.alloc(4);
  // Over the type and the data, never the length — the one detail a hand-written
  // PNG writer gets wrong, and it produces a file every decoder rejects.
  crc.writeUInt32BE(crc32(head.subarray(4), data), 0);

  return Buffer.concat([head, data, crc]);
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(...parts: readonly Buffer[]): number {
  let value = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) {
      value = (CRC_TABLE[(value ^ byte) & 0xff] as number) ^ (value >>> 8);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
