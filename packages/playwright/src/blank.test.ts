import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  type BlankRule,
  blankKey,
  blankPng,
  blankRuleError,
  blankRuleFor,
  blankUrlAimedAt,
  imageSize,
} from './blank.js';

/**
 * Headers built a byte at a time, and one PNG checked against a second opinion.
 *
 * The size readers are parsers of somebody else's format, so their inputs are
 * spelled out here rather than produced by an encoder — an encoder would test
 * this against one library's habits, and what has to hold is a property of the
 * format. The writer is checked the other way: its chunk CRCs are verified
 * against `zlib.crc32`, which is an implementation this file did not write, and
 * its pixel data is inflated and asserted to be zeroes.
 *
 * What none of this proves is that a browser accepts the result. That is
 * `network.chromium.test.ts`, where one actually decodes it.
 */

function png(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(13);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

/** Baseline JPEG: `SOI`, an `APP0` to be skipped, then `SOF0`. */
function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
  const bytes = Buffer.alloc(31);
  bytes.writeUInt16BE(0xffd8, 0);
  bytes.writeUInt16BE(0xffe0, 2);
  bytes.writeUInt16BE(16, 4); // APP0, 16 bytes of segment
  bytes.writeUInt16BE(0xff00 | marker, 20);
  bytes.writeUInt16BE(11, 22); // SOF, 11 bytes of segment
  bytes.writeUInt8(8, 24); // sample precision
  bytes.writeUInt16BE(height, 25);
  bytes.writeUInt16BE(width, 27);
  return bytes;
}

function riff(chunk: string, payload: Buffer): Uint8Array {
  const bytes = Buffer.alloc(12 + payload.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32BE(0, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write(chunk, 12, 'ascii');
  payload.copy(bytes, 16);
  return bytes;
}

describe('imageSize', () => {
  it('reads a PNG header', () => {
    expect(imageSize(png(1200, 600))).toEqual({ width: 1200, height: 600 });
  });

  it('reads a GIF logical screen, which is little-endian', () => {
    expect(imageSize(gif(320, 240))).toEqual({ width: 320, height: 240 });
  });

  it('reads a JPEG frame header past a segment it does not care about', () => {
    expect(imageSize(jpeg(800, 450))).toEqual({ width: 800, height: 450 });
  });

  it('reads a progressive JPEG, whose frame marker is not SOF0', () => {
    expect(imageSize(jpeg(800, 450, 0xc2))).toEqual({ width: 800, height: 450 });
  });

  it('reads an extended WebP canvas, stored one short of the truth', () => {
    const payload = Buffer.alloc(20);
    payload.writeUIntLE(1919, 8, 3); // 1920 - 1
    payload.writeUIntLE(1079, 11, 3); // 1080 - 1
    expect(imageSize(riff('VP8X', payload))).toEqual({ width: 1920, height: 1080 });
  });

  it('reads a lossless WebP, whose dimensions are packed across bytes', () => {
    const payload = Buffer.alloc(20);
    payload.writeUInt8(0x2f, 4);
    payload.writeUInt32LE(((300 - 1) << 14) | (400 - 1), 5);
    expect(imageSize(riff('VP8L', payload))).toEqual({ width: 400, height: 300 });
  });

  it('refuses a format it does not read, rather than guessing', () => {
    expect(imageSize(Buffer.from('<svg width="10" height="10"/>'))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
    expect(imageSize(Buffer.from('not an image at all, but long enough to be one'))).toBeNull();
  });

  it('does not walk off the end of a truncated JPEG', () => {
    expect(imageSize(jpeg(800, 450).slice(0, 12))).toBeNull();
  });
});

describe('blankRuleFor', () => {
  const rules: readonly BlankRule[] = [
    { id: 'icons', url: '**/icons/**', maxPixels: 4096 },
    { id: 'illustrations', minPixels: 40_000 },
  ];

  it('blanks a large illustration', () => {
    const rule = blankRuleFor(rules, 'https://cdn.test/hero.png', { width: 1200, height: 600 });
    expect(rule?.id).toBe('illustrations');
  });

  it('keeps a chevron, because no rule reaches down that far', () => {
    expect(blankRuleFor(rules, 'https://cdn.test/chevron.svg', { width: 16, height: 16 })).toBeNull();
  });

  it('applies every matcher a rule names, not the first one', () => {
    // The path matches `icons`, the area does not — and `illustrations` has no
    // URL of its own, so a large icon is blanked by the size rule instead.
    const large = blankRuleFor(rules, 'https://cdn.test/icons/huge.png', {
      width: 400,
      height: 400,
    });
    expect(large?.id).toBe('illustrations');

    const small = blankRuleFor(rules, 'https://cdn.test/icons/close.png', {
      width: 32,
      height: 32,
    });
    expect(small?.id).toBe('icons');
  });

  it('takes the first rule that applies, so order is the operator’s tiebreak', () => {
    const both: readonly BlankRule[] = [
      { id: 'first', minPixels: 1 },
      { id: 'second', minPixels: 1 },
    ];
    expect(blankRuleFor(both, 'x', { width: 2, height: 2 })?.id).toBe('first');
  });
});

describe('blankRuleError', () => {
  it('accepts a rule that names something', () => {
    expect(blankRuleError([{ id: 'a', url: '**' }])).toBeNull();
    expect(blankRuleError([{ id: 'a', minPixels: 1 }])).toBeNull();
  });

  it('refuses a rule that names nothing, rather than blanking the whole page', () => {
    expect(blankRuleError([{ id: 'oops' }])).toContain('names nothing');
  });

  it('refuses two rules under one id, because the ledger names them', () => {
    expect(
      blankRuleError([
        { id: 'a', url: '**/x' },
        { id: 'a', url: '**/y' },
      ]),
    ).toContain('both called');
  });

  it('refuses a band no image can satisfy', () => {
    expect(blankRuleError([{ id: 'a', minPixels: 100, maxPixels: 10 }])).toContain('no image');
  });

  it('refuses an unnamed rule', () => {
    expect(blankRuleError([{ id: '', url: '**' }])).toContain('needs an id');
  });
});

describe('blankKey', () => {
  it('carries the size, so a resized image still moves the environment key', () => {
    const rule: BlankRule = { id: 'illustrations', minPixels: 1 };
    expect(blankKey(rule, { width: 1200, height: 600 })).toBe('blank:illustrations:1200x600');
    expect(blankKey(rule, { width: 1200, height: 601 })).not.toBe(
      blankKey(rule, { width: 1200, height: 600 }),
    );
  });

  it('says what it is in its own shape, next to a digest that says the other thing', () => {
    expect(blankKey({ id: 'a', minPixels: 1 }, { width: 1, height: 1 })).toMatch(/^blank:/);
  });
});

describe('blankUrlAimedAt', () => {
  it('is true only for a rule that named a path', () => {
    expect(blankUrlAimedAt([{ id: 'a', url: '**/hero/**' }], 'https://x/hero/a.svg')).toBe(true);
    expect(blankUrlAimedAt([{ id: 'a', url: '**/hero/**' }], 'https://x/other/a.svg')).toBe(false);
    expect(blankUrlAimedAt([{ id: 'a', minPixels: 1 }], 'https://x/hero/a.svg')).toBe(false);
  });
});

describe('blankPng', () => {
  it('round-trips through this file’s own reader at the size asked for', () => {
    expect(imageSize(blankPng(1200, 600))).toEqual({ width: 1200, height: 600 });
  });

  it('writes chunk CRCs an implementation it did not author agrees with', () => {
    const bytes = blankPng(64, 48);
    const chunks: string[] = [];

    let offset = 8;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 8 + length;
      chunks.push(bytes.toString('ascii', offset + 4, offset + 8));
      expect(crc32(bytes.subarray(offset + 4, end))).toBe(bytes.readUInt32BE(end));
      offset = end + 4;
    }

    expect(offset).toBe(bytes.length);
    expect(chunks).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
  });

  it('is a one-bit palette with a transparent entry, which is why it is small', () => {
    const bytes = blankPng(2000, 2000);
    expect(bytes[24]).toBe(1); // bit depth
    expect(bytes[25]).toBe(3); // colour type: palette

    // Every byte of pixel data is zero: filter `None`, palette index 0, whose
    // alpha `tRNS` set to zero.
    const start = bytes.indexOf(Buffer.from('IDAT', 'ascii'));
    const length = bytes.readUInt32BE(start - 4);
    const raw = inflateSync(bytes.subarray(start + 4, start + 4 + length));
    expect(raw.length).toBe(2000 * (Math.ceil(2000 / 8) + 1));
    expect(raw.every((byte) => byte === 0)).toBe(true);

    // The point of the palette: sixteen megabytes as RGBA, half a megabyte here,
    // and a few hundred bytes once deflate has seen it.
    expect(bytes.length).toBeLessThan(4096);
  });
});
