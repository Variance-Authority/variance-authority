import { describe, expect, it } from 'vitest';
import { freezeGif } from './gif.js';

/**
 * GIFs built a byte at a time, because the assertion is about bytes.
 *
 * A fixture file would test the same code against one encoder's habits. What
 * has to hold is a property of the *format* — that a single-frame prefix plus a
 * trailer is a complete GIF — so the inputs are constructed here, with every
 * block spelled out, including the ones designed to be unparseable.
 */

/** `GIF89a`, 2×1, a two-entry global colour table. */
const HEADER = [
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x02, 0x00, 0x01, 0x00, // 2 × 1
  0x80, // global colour table, 2 entries
  0x00, 0x00, // background index, pixel aspect ratio
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, // black, white
];

/** Graphic control extension: 4 bytes of data, then the sub-block terminator. */
const GRAPHIC_CONTROL = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00];

/**
 * An image descriptor with three bytes of pixel data.
 *
 * The LZW payload is not valid and does not need to be: nothing here decodes
 * pixels, and the parse walks sub-block *lengths*. A browser is the thing that
 * needs real pixels, and that is what the Chromium suite is for.
 */
const IMAGE = [
  0x2c, // image separator
  0x00, 0x00, 0x00, 0x00, // left, top
  0x02, 0x00, 0x01, 0x00, // 2 × 1
  0x00, // no local colour table
  0x02, // LZW minimum code size
  0x03, 0x44, 0x01, 0x00, // one sub-block of three bytes, then the terminator
  0x00, // sub-block chain terminator
];

const TRAILER = [0x3b];

function gif(...blocks: readonly (readonly number[])[]): Uint8Array {
  return new Uint8Array(blocks.flat());
}

const ANIMATED = gif(HEADER, GRAPHIC_CONTROL, IMAGE, GRAPHIC_CONTROL, IMAGE, TRAILER);
const STATIC = gif(HEADER, GRAPHIC_CONTROL, IMAGE, TRAILER);

describe('freezing an animated GIF', () => {
  it('keeps everything up to the first frame and closes the file', () => {
    const frozen = freezeGif(ANIMATED);

    expect(frozen).not.toBeNull();
    // The point of truncating rather than re-encoding: every byte it keeps is a
    // byte the author shipped. A canvas round-trip would return a PNG whose
    // palette and compression are this tool's, not the asset's.
    expect([...frozen!.subarray(0, frozen!.length - 1)]).toEqual([
      ...HEADER,
      ...GRAPHIC_CONTROL,
      ...IMAGE,
    ]);
    expect(frozen![frozen!.length - 1]).toBe(0x3b);
  });

  it('produces a file the length arithmetic agrees with', () => {
    const frozen = freezeGif(ANIMATED)!;

    expect(frozen.length).toBe(HEADER.length + GRAPHIC_CONTROL.length + IMAGE.length + 1);
    expect(frozen.length).toBeLessThan(ANIMATED.length);
  });

  it('reads a local colour table rather than walking into its bytes', () => {
    // The local table is 2^(0+1) = 2 entries of three bytes. A parse that missed
    // the flag would land inside the palette and read a colour as a block
    // marker — and the failure would be a corrupt image, not an exception.
    const localTable = [
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00,
      0x80, // local colour table, 2 entries
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, // the palette itself
      0x02, 0x03, 0x44, 0x01, 0x00, 0x00,
    ];

    const frozen = freezeGif(gif(HEADER, localTable, GRAPHIC_CONTROL, IMAGE, TRAILER))!;

    expect(frozen.length).toBe(HEADER.length + localTable.length + 1);
    expect([...frozen.subarray(HEADER.length, HEADER.length + localTable.length)]).toEqual(
      localTable,
    );
  });

  it('keeps a graphic control extension, because it carries transparency', () => {
    const frozen = freezeGif(ANIMATED)!;

    // Dropping the extension before the first image would turn a transparent
    // GIF opaque — a stabilizer changing the picture it was asked to hold still.
    expect([...frozen.subarray(HEADER.length, HEADER.length + GRAPHIC_CONTROL.length)]).toEqual(
      GRAPHIC_CONTROL,
    );
  });
});

describe('leaving alone what it cannot honestly improve', () => {
  it('refuses a GIF that already holds one frame', () => {
    // Not "rewrites it identically". The caller reports what it froze, and a
    // file that was already static was not frozen by anybody.
    expect(freezeGif(STATIC)).toBeNull();
  });

  it('refuses bytes that are not a GIF', () => {
    expect(freezeGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(freezeGif(new Uint8Array())).toBeNull();
    expect(freezeGif(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull();
  });

  it('refuses a file whose blocks it does not recognise', () => {
    // A truncation taken from a position the parse cannot vouch for is a corrupt
    // asset served to a browser, which is worse than the flake it prevents.
    expect(freezeGif(gif(HEADER, [0x99, 0x99], IMAGE, TRAILER))).toBeNull();
  });

  it('does not run away on a sub-block length that overruns the file', () => {
    // The one loop that can hang. A hostile or truncated file claims a 255-byte
    // sub-block near the end and the walk steps past the buffer.
    const overrun = gif(HEADER, [0x21, 0xf9, 0xff, 0x00, 0x01]);

    expect(freezeGif(overrun)).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    // This runs inside a request handler. A stabilizer that can take down a page
    // load is worse than the flake it prevents.
    const fuzz = [
      gif(HEADER),
      gif(HEADER, [0x2c]),
      gif(HEADER, [0x21]),
      gif(HEADER, GRAPHIC_CONTROL),
      gif([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    ];

    for (const bytes of fuzz) expect(() => freezeGif(bytes)).not.toThrow();
  });
});
