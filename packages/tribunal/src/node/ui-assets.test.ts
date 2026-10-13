import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { REVIEW_STYLES } from '../ui/styles.js';
import { uiFont } from './ui-assets.js';

/**
 * The faces the tokens ask for are the faces the package ships.
 *
 * `REVIEW_STYLES` names a family first and `fonts/fonts.css` declares it, and
 * nothing but these two lists ties them together: rename a token's face and the
 * sheet declares one nobody asks for, while every caption falls back to a
 * system face on any machine without the new one installed.
 */

function firstFamily(token: string): string {
  const stack = new RegExp(`${token}:\\s*"([^"]+)"`).exec(REVIEW_STYLES)?.[1];
  if (stack === undefined) throw new Error(`${token} names no quoted family first`);
  return stack;
}

async function sheet(): Promise<string> {
  const font = await uiFont('fonts.css');
  if (font === null) throw new Error('fonts/fonts.css is not shipped');
  return new TextDecoder().decode(font.bytes);
}

describe('the faces the review surface is set in', () => {
  it('declares the family each font token names first', async () => {
    const declared = [...(await sheet()).matchAll(/font-family:\s*"([^"]+)"/g)].map((match) => match[1]);

    expect(declared).toEqual([firstFamily('--va-sans'), firstFamily('--va-mono')]);
  });

  it('ships every file the sheet names', async () => {
    const named = [...(await sheet()).matchAll(/url\("\.\/([^"]+)"\)/g)].map((match) => match[1]!);

    for (const file of named) expect([file, (await uiFont(file))?.bytes.byteLength ?? 0]).not.toEqual([file, 0]);
  });

  it('ships the same files the site is set in', async () => {
    // One brand, two copies: the site serves its own and a package cannot
    // reach into `site/`, so the copies are held equal here instead.
    for (const file of ['inter.woff2', 'jetbrains-mono.woff2']) {
      const site = await readFile(new URL(`../../../../site/public/fonts/${file}`, import.meta.url));
      expect([file, Buffer.from((await uiFont(file))!.bytes).equals(site)]).toEqual([file, true]);
    }
  });
});
