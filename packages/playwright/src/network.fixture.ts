import { crc32, deflateSync } from 'node:zlib';

/**
 * Images for the Chromium network suites, written here rather than produced by
 * the code under test, so a substitution that changed nothing cannot pass by
 * comparing its own output against itself.
 */

/**
 * Four frames, 8×8, alternating solid black and solid white.
 *
 * Solid and large enough that a screenshot difference is unmissable — the
 * failure this guards against is a freeze that *nearly* works, and a two-pixel
 * image would let one pass. The LZW payload is real: a browser decodes this.
 * With a two-colour table the minimum code size is 2, so clear is 4 and end is
 * 5, and 64 pixels of one index compress to a run of that index's code.
 */
export function animatedGif(): Buffer {
  const side = 8;

  const header = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    side, 0x00, side, 0x00,
    0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, // index 0: black
    0xff, 0xff, 0xff, // index 1: white
  ];

  // NETSCAPE2.0, loop forever — so the browser is genuinely animating rather
  // than resting on a last frame, which would let a broken freeze look correct.
  const loop = [
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00,
  ];

  const frame = (index: number): readonly number[] => {
    // Real LZW, and the fiddly part is the code width. With a minimum code size
    // of 2 the stream starts at 3 bits, `clear` is 4, `end` is 5, and the next
    // free dictionary slot is 6 — so after two data codes the next slot is 8 and
    // the decoder switches to 4-bit codes. Emitting everything at 3 bits
    // produces a file that decodes to nothing, which is the failure mode that
    // matters here: a GIF that never paints makes *both* arms of this suite
    // pass, the frozen one vacuously.
    //
    // Re-clearing every two codes keeps the width at 3 forever. It compresses
    // nothing, which is the right trade for a fixture whose bit packing a reader
    // has to be able to check by hand.
    const codes: number[] = [];
    for (let pixel = 0; pixel < side * side; pixel += 2) {
      codes.push(4, index, index);
    }
    codes.push(5);

    const bytes: number[] = [];
    let bits = 0;
    let width = 0;
    for (const code of codes) {
      bits |= code << width;
      width += 3;
      while (width >= 8) {
        bytes.push(bits & 0xff);
        bits >>>= 8;
        width -= 8;
      }
    }
    if (width > 0) bytes.push(bits & 0xff);

    const subBlocks: number[] = [];
    for (let at = 0; at < bytes.length; at += 255) {
      const slice = bytes.slice(at, at + 255);
      subBlocks.push(slice.length, ...slice);
    }
    subBlocks.push(0x00);

    return [
      0x21, 0xf9, 0x04, 0x00, 0x06, 0x00, 0x00, 0x00, // 60ms per frame
      0x2c, 0x00, 0x00, 0x00, 0x00, side, 0x00, side, 0x00, 0x00,
      0x02,
      ...subBlocks,
    ];
  };

  return Buffer.from([...header, ...loop, ...frame(0), ...frame(1), ...frame(0), ...frame(1), 0x3b]);
}


/**
 * An opaque PNG, written here rather than imported from the thing under test.
 *
 * `blankPng` could produce these in one line and the blanking suite would then
 * be comparing its own output against itself — a substitution that changed
 * nothing would pass. So this writes its own: same one-bit palette, no `tRNS`,
 * palette entry 0 set to solid black, so every pixel paints.
 */
export function solidPng(width: number, height: number): Buffer {
  const stride = Math.ceil(width / 8);
  const raw = Buffer.alloc(height * (stride + 1));

  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(1, 8);
  header.writeUInt8(3, 9);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', Buffer.from([0, 0, 0])),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

