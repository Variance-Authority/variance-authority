import { keepImage } from '@variance-authority/png-sharp';

/**
 * A store keeps the lossless WebP an accept encoded, and refuses anything else,
 * so a test raster carries kept bytes. Each is a one-pixel image of a different
 * colour, so two entries are told apart by their bytes, and a store hands back
 * exactly the bytes it was given. The PNG of each is a capture as a renderer
 * hands it over: what the render cache holds, and what a baseline kept before
 * WebP holds on disk.
 */
export const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
export const GREEN_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNg+M/wHwAEAQH/g5vEFwAAAABJRU5ErkJggg==';
export const BLUE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNgYPj/HwADAgH/FAeIXAAAAABJRU5ErkJggg==';
export const WHITE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=';

async function kept(bytes: string): Promise<string> {
  return (await keepImage(Buffer.from(bytes, 'base64'))).toString('base64');
}

export const RED = await kept(RED_PNG);
export const GREEN = await kept(GREEN_PNG);
export const BLUE = await kept(BLUE_PNG);
export const WHITE = await kept(WHITE_PNG);

/** The PNG a kept colour was encoded from, for a test that lays down a baseline kept before WebP. */
export function asPng(kept: string): string {
  const png = { [RED]: RED_PNG, [GREEN]: GREEN_PNG, [BLUE]: BLUE_PNG, [WHITE]: WHITE_PNG }[kept];
  if (png === undefined) throw new Error('not one of the kept colours in image.fixture.ts');
  return png;
}
