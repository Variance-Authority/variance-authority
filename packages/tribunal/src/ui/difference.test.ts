// @vitest-environment jsdom
import { PNG } from 'pngjs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffImage } from '@variance-authority/png';
import { createReviewClient } from './client.js';
import { decodeBlob, differenceOf, hasDifference, useDifference } from './difference.js';
import type { Loaded } from './shell.js';

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

    expect(pixelsOf(Buffer.from(await blob.arrayBuffer()))).toEqual(pixelsOf(await diffImage(BEFORE, AFTER)));
  });

  it('pads onto the union box exactly as the run does', async () => {
    // The case a reimplementation gets wrong: a capture that grew differs in the
    // rows it gained, against opaque white, not against nothing.
    const blob = await differenceOf(serving(BEFORE, TALLER), 'ci-1', 'story:card');

    const made = PNG.sync.read(Buffer.from(await blob.arrayBuffer()));
    expect({ width: made.width, height: made.height }).toEqual({ width: 40, height: 44 });
    expect(new Uint8Array(made.data)).toEqual(pixelsOf(await diffImage(BEFORE, TALLER)));
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

describe('the mask, as the page holds it', () => {
  it('is being made until the computation settles, then made, and its URL is let go on unmount', async () => {
    // A failed computation is held apart from one in progress: the viewer's
    // test of that state is in `failed-mask.test.tsx`.
    const client = serving(BEFORE, AFTER);
    const subject = { subject: 'story:card', has: { before: true, after: true, diff: false } };
    const held: (Loaded<string> | undefined)[] = [];
    const revoked: string[] = [];
    const url = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = () => 'blob:made';
    URL.revokeObjectURL = (made) => void revoked.push(made);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    function Probe(): null {
      held.push(useDifference(client, 'ci-1', subject));
      return null;
    }

    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => {
        root.render(createElement(Probe));
        await new Promise((settle) => setTimeout(settle, 0));
      });
      act(() => root.unmount());
    } finally {
      URL.createObjectURL = url.create;
      URL.revokeObjectURL = url.revoke;
    }

    expect(held[0]).toEqual({ state: 'loading' });
    expect(held.at(-1)).toEqual({ state: 'ready', value: 'blob:made' });
    expect(revoked).toEqual(['blob:made']);
  });
});

describe('the mask of one subject, read while showing another', () => {
  it('is the new subject being made, never the last subject\u2019s failure', async () => {
    // The state is set from an effect, and an effect runs after the frame
    // that switched subject. Read without its subject, the first frame of the
    // next render says why the last one failed.
    const client = createReviewClient({
      endpoint: '/api',
      fetch: (async (url: string) =>
        url.includes(encodeURIComponent('story:a'))
          ? new Response('gone', { status: 404 })
          : await new Promise<Response>(() => undefined)) as typeof globalThis.fetch,
    });
    const has = { before: true, after: true, diff: false };
    const held: (Loaded<string> | undefined)[] = [];
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    function Probe({ subject }: { readonly subject: string }): null {
      held.push(useDifference(client, 'ci-1', { subject, has }));
      return null;
    }

    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(createElement(Probe, { subject: 'story:a' }));
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(held.at(-1)?.state).toBe('failed');

    const before = held.length;
    act(() => root.render(createElement(Probe, { subject: 'story:b' })));
    act(() => root.unmount());

    const after = held.slice(before).map((each) => each?.state);
    expect(after[0]).toBe('loading');
    expect(after).not.toContain('failed');
  });

  it('keeps the new subject\u2019s answer when the last subject\u2019s settles after it', async () => {
    // The last subject's computation is not cancelled, only let go. Settling
    // after the new subject's, it would replace that answer with its own,
    // and the new subject would read as still being made.
    const late: (() => void)[] = [];
    const client = createReviewClient({
      endpoint: '/api',
      fetch: (async (url: string) =>
        url.includes(encodeURIComponent('story:a'))
          ? await new Promise<Response>((answer) => late.push(() => answer(new Response('gone', { status: 404 }))))
          : new Response('gone', { status: 404 })) as typeof globalThis.fetch,
    });
    const has = { before: true, after: true, diff: false };
    const held: (Loaded<string> | undefined)[] = [];
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    function Probe({ subject }: { readonly subject: string }): null {
      held.push(useDifference(client, 'ci-1', { subject, has }));
      return null;
    }

    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe, { subject: 'story:a' })));
    await act(async () => {
      root.render(createElement(Probe, { subject: 'story:b' }));
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(held.at(-1)?.state).toBe('failed');

    await act(async () => {
      for (const answer of late) answer();
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(held.at(-1)?.state).toBe('failed');
    act(() => root.unmount());
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
