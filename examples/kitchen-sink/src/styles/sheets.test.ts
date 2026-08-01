/**
 * `tokens.css` and its embedded copy must not drift.
 *
 * The duplication is deliberate — see `sheets.ts` for why the fixtures cannot just
 * read the file — and duplication without an equality check is how a corpus starts
 * measuring one thing while claiming to measure another. The failure it prevents
 * is specific: the browser page would keep rendering the token values a designer
 * edited while the JSDOM tests kept rendering the old ones, so the two observation
 * profiles would disagree for a reason that has nothing to do with observation.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOKENS_CSS } from './sheets.js';

describe('tokens.css', () => {
  it('matches its embedded copy byte for byte', () => {
    const onDisk = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
    expect(TOKENS_CSS).toBe(onDisk);
  });

  it('defines only custom properties, so every value is token-attributable', () => {
    const declarations = Array.from(TOKENS_CSS.matchAll(/^\s{2}([a-z-]+):/gm)).map((m) => m[1]);
    expect(declarations.length).toBeGreaterThan(10);
    for (const property of declarations) {
      expect(property?.startsWith('--'), property).toBe(true);
    }
  });
});
