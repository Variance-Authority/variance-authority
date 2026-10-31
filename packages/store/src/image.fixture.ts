import { keepImage } from '@variance-authority/png';

/**
 * A store keeps real images: it encodes an accepted PNG to a lossless WebP
 * before it writes anything, so a test raster carries bytes a store can encode.
 * Each is a one-pixel PNG of a different colour, so two entries are told apart
 * by their bytes, and {@link kept} is what a store hands back for one.
 */
export const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
export const GREEN = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNg+M/wHwAEAQH/g5vEFwAAAABJRU5ErkJggg==';
export const BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNgYPj/HwADAgH/FAeIXAAAAABJRU5ErkJggg==';
export const WHITE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=';

/** The base64 bytes a store keeps, and returns, for a capture's base64 bytes. */
export async function kept(bytes: string): Promise<string> {
  return (await keepImage(Buffer.from(bytes, 'base64'))).toString('base64');
}
