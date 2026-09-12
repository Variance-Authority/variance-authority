// @vitest-environment jsdom
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffImage } from '@variance-authority/png';
import { createReviewClient } from './client.js';
import { decodeBlob, differenceOf, hasDifference } from './difference.js';

/**
 * The mask the reviewer sees, held to the mask the run measured.
 *
 * This is the only place in the project where one picture is produced by two
 * programs — Node writing a report, and a browser answering a reviewer who asked
 * to see a difference nobody uploaded. The whole defence is that the arithmetic
 * is one function in `@variance-authority/png/mask` and both call it, so what is
 * worth testing is not the arithmetic but the wiring around it: that the bytes
 * reaching that function are the bytes in the file, and that what comes back is
 * drawn without anything being converted on the way.
 *
 * **Pixel-identical, not byte-identical.** A browser's PNG encoder and `pngjs`
 * compress the same pixels differently, and a test that compared files would be
 * asserting something neither end promises.
 */

/** A PNG of solid colour with one rectangle painted over it. */
function picture(
  width: number,
  height: number,
  base: readonly [number, number, number],
  mark?: { x: number; y: number; width: number; height: number; rgb: readonly [number, number, number] },
): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside =
        mark !== undefined &&
        x >= mark.x &&
        x < mark.x + mark.width &&
        y >= mark.y &&
        y < mark.y + mark.height;
      const [r, g, b] = inside ? mark.rgb : base;
      const at = (y * width + x) * 4;
      png.data[at] = r;
      png.data[at + 1] = g;
      png.data[at + 2] = b;
      png.data[at + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const BEFORE = picture(40, 30, [250, 250, 250]);
const AFTER = picture(40, 30, [250, 250, 250], { x: 8, y: 6, width: 9, height: 7, rgb: [20, 80, 200] });
/** Taller, so the union box and the padding rule are exercised too. */
const TALLER = picture(40, 44, [250, 250, 250], { x: 8, y: 6, width: 9, height: 7, rgb: [20, 80, 200] });

/** Every option the decode asked for, so the colour-management promise is checked. */
const asked: ImageBitmapOptions[] = [];

class Context {
  held: { width: number; height: number; data: Uint8ClampedArray } | undefined;
  constructor(private readonly canvas: Canvas) {}
  drawImage(bitmap: { width: number; height: number; data: Uint8ClampedArray }): void {
    this.held = bitmap;
  }
  getImageData(): { width: number; height: number; data: Uint8ClampedArray } {
    if (this.held === undefined) throw new Error('nothing was drawn');
    return this.held;
  }
  putImageData(image: { width: number; height: number; data: Uint8ClampedArray }): void {
    this.held = image;
  }
  encode(): Buffer {
    if (this.held === undefined) throw new Error('nothing was drawn');
    const png = new PNG({ width: this.canvas.width, height: this.canvas.height });
    png.data.set(this.held.data);
    return PNG.sync.write(png);
  }
}

class Canvas {
  private readonly context = new Context(this);
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext(): Context {
    return this.context;
  }
  async convertToBlob(): Promise<Blob> {
    return new Blob([new Uint8Array(this.context.encode())], { type: 'image/png' });
  }
}

const globals = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  asked.length = 0;
  for (const name of ['createImageBitmap', 'OffscreenCanvas', 'ImageData']) {
    saved[name] = globals[name];
  }

  globals['createImageBitmap'] = async (blob: Blob, options: ImageBitmapOptions) => {
    asked.push(options);
    const png = PNG.sync.read(Buffer.from(await blob.arrayBuffer()));
    return {
      width: png.width,
      height: png.height,
      data: new Uint8ClampedArray(png.data),
      close: (): void => undefined,
    };
  };
  globals['OffscreenCanvas'] = Canvas;
  globals['ImageData'] = class {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  };
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) globals[name] = value;
});

/** A client that serves the two captures and refuses everything else. */
function serving(before: Buffer, after: Buffer) {
  return createReviewClient({
    endpoint: '/api',
    fetch: (async (url: string) => {
      const bytes = url.endsWith('before.png') ? before : url.endsWith('after.png') ? after : null;
      if (bytes === null) return new Response('no', { status: 404 });
      return new Response(new Uint8Array(bytes), { status: 200 });
    }) as typeof globalThis.fetch,
  });
}

function pixelsOf(bytes: Buffer): Uint8Array {
  const png = PNG.sync.read(bytes);
  return new Uint8Array(png.data);
}

describe('the mask the page computes', () => {
  it('is pixel-identical to the one the run would have written', async () => {
    const blob = await differenceOf(serving(BEFORE, AFTER), 'ci-1', 'story:card');

    expect(pixelsOf(Buffer.from(await blob.arrayBuffer()))).toEqual(pixelsOf(diffImage(BEFORE, AFTER)));
  });

  it('pads onto the union box exactly as the run does', async () => {
    // The case a reimplementation gets wrong: a capture that grew differs in the
    // rows it gained, against opaque white, not against nothing.
    const blob = await differenceOf(serving(BEFORE, TALLER), 'ci-1', 'story:card');

    const made = PNG.sync.read(Buffer.from(await blob.arrayBuffer()));
    expect({ width: made.width, height: made.height }).toEqual({ width: 40, height: 44 });
    expect(new Uint8Array(made.data)).toEqual(pixelsOf(diffImage(BEFORE, TALLER)));
  });

  it('declines every colour conversion on the way in', async () => {
    await differenceOf(serving(BEFORE, AFTER), 'ci-1', 'story:card');

    expect(asked).toEqual([
      { colorSpaceConversion: 'none' },
      { colorSpaceConversion: 'none' },
    ]);
  });

  it('decodes the pixels that are in the file', async () => {
    const decoded = await decodeBlob(new Blob([new Uint8Array(AFTER)]));

    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 40, height: 30 });
    expect(new Uint8Array(decoded.data)).toEqual(pixelsOf(AFTER));
  });
});

describe('whether a difference can be shown', () => {
  const has = (before: boolean, after: boolean, diff: boolean) => ({
    subject: 'story:card',
    has: { before, after, diff },
  });

  it('is yes for a build that kept a mask, however it was pushed', () => {
    // The shape an older CLI left behind: the object is in the bucket and is
    // still served rather than recomputed.
    expect(hasDifference(has(false, true, true))).toBe(true);
  });

  it('is yes for a build that kept both captures and no mask', () => {
    expect(hasDifference(has(true, true, false))).toBe(true);
  });

  it('is no when there is nothing to compare', () => {
    expect(hasDifference(has(false, true, false))).toBe(false);
    expect(hasDifference(has(true, false, false))).toBe(false);
  });
});
