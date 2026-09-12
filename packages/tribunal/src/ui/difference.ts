/**
 * The difference mask, computed where it is looked at.
 *
 * A run's own report still writes a diff PNG — that is what a developer opens
 * locally, and a deployment of this service is optional, so nothing about CI
 * changes here. What changed is the wire: a mask is, by construction, new bytes
 * every time anything moved, so it is the one image content addressing can never
 * deduplicate. `before` is always a hit (it *is* the baseline this deployment
 * handed the run) and an unchanged `after` is a second copy of one. The mask is
 * pure upload, on every run, forever — for a picture that a browser holding both
 * captures can produce in a few milliseconds.
 *
 * So a current `variance push` does not send it, and this computes it on the one
 * occasion a reviewer asks to see it. Builds pushed by older versions still hold
 * a stored mask and are still served it; {@link maskOf} is the seam that decides.
 *
 * ## Why this cannot drift from the run's own diff
 *
 * It is the same function. {@link differencePixels} is
 * `@variance-authority/png/mask` — the codec-free half of the package — and
 * `diffImage`, which writes the file in the report, delegates to it too. The
 * padding rule and the policy come from one place, so a reviewer's mask and a
 * report's mask cannot disagree about a threshold, an anti-aliasing rule, or
 * what a grown capture does to the union box. Two ends computing the same thing
 * from their own copy of the arithmetic is silent breakage; two ends calling one
 * function is not.
 *
 * ## Colour management is turned off, deliberately
 *
 * A browser handed a PNG with an embedded profile will happily convert it on the
 * way to a canvas, and `getImageData` then returns pixels that are not the ones
 * in the file. Every such conversion is a difference this surface invented —
 * exactly the failure the rest of the project refuses — so decoding asks for
 * none, on both the bitmap and the context.
 */

import { useEffect, useState } from 'react';
import { differencePixels, type DecodedImage, type PixelDifference } from '@variance-authority/png/mask';
import type { ReviewClient } from './client.js';

/** What this needs of a subject: its name, and what the build actually kept. */
export interface Comparable {
  readonly subject: string;
  readonly has: {
    readonly before: boolean;
    readonly after: boolean;
    readonly diff: boolean;
  };
}

/**
 * Whether a difference mask can be shown at all — stored or computable.
 *
 * `has.diff` stays truthful about the object in the bucket, because that is what
 * it is: a row with a key or without one. This is the question the surface
 * actually asks, and it is a different one.
 */
export function hasDifference(subject: Comparable): boolean {
  return subject.has.diff || (subject.has.before && subject.has.after);
}

/**
 * A URL for the difference mask, computed if the build did not keep one.
 *
 * `undefined` while it is being made, and while `wanted` is false — nothing is
 * decoded for a mode nobody opened. The object URL is revoked when the subject
 * changes or the component unmounts; two full-page captures is real memory and
 * leaving it to the collector means holding every subject a reviewer walked
 * past.
 */
export function useDifferenceUrl(
  client: ReviewClient,
  build: string,
  subject: Comparable,
  wanted = true,
): string | undefined {
  const stored = subject.has.diff ? client.imageUrl(build, subject.subject, 'diff') : undefined;
  const [made, setMade] = useState<string>();

  const computable = stored === undefined && wanted && hasDifference(subject);

  useEffect(() => {
    if (!computable) return undefined;

    let url: string | undefined;
    let dropped = false;

    void differenceOf(client, build, subject.subject).then(
      (blob) => {
        if (dropped) return;
        url = URL.createObjectURL(blob);
        setMade(url);
      },
      () => {
        // Left undefined: the caller draws nothing rather than a broken frame,
        // and the two captures are still one click away in every other mode.
        if (!dropped) setMade(undefined);
      },
    );

    return () => {
      dropped = true;
      setMade(undefined);
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [client, build, subject.subject, computable]);

  return stored ?? made;
}

/** Both captures, decoded, differenced and encoded — the whole of the work. */
export async function differenceOf(
  client: ReviewClient,
  build: string,
  subject: string,
): Promise<Blob> {
  const [before, after] = await Promise.all([
    client.imageBlob(build, subject, 'before').then(decodeBlob),
    client.imageBlob(build, subject, 'after').then(decodeBlob),
  ]);
  return await encodePixels(differencePixels(before, after));
}

/** PNG bytes to RGBA, with every conversion a browser would offer declined. */
export async function decodeBlob(blob: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  try {
    const context = surface(bitmap.width, bitmap.height).getContext('2d', {
      colorSpace: 'srgb',
      willReadFrequently: true,
    });
    if (context === null) throw new Error('this browser gave no 2d context to decode into');

    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' });
    return { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer) };
  } finally {
    bitmap.close();
  }
}

/** RGBA back to something an `<img>` will take. */
export async function encodePixels(pixels: PixelDifference): Promise<Blob> {
  const canvas = surface(pixels.width, pixels.height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (context === null) throw new Error('this browser gave no 2d context to draw the mask on');

  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height, {
      colorSpace: 'srgb',
    }),
    0,
    0,
  );

  if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: 'image/png' });
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('this browser encoded the mask to nothing'));
      else resolve(blob);
    }, 'image/png');
  });
}

/**
 * A drawing surface, off the document when the browser has one.
 *
 * `OffscreenCanvas` keeps a full-page capture out of the layout tree entirely;
 * the element is the fallback, and is never attached.
 */
function surface(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
