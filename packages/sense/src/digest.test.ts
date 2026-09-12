import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  digestBytes as portableBytes,
  digestString as portableString,
} from '@variance-authority/core/format';
import { digestBytes, digestString } from './digest.js';

/**
 * The two implementations agree, which is the whole permission for there to be
 * two.
 *
 * `core` hashes in portable TypeScript so it can run inside a page; `sense`
 * hashes with `node:crypto` because it never does and the platform's is an order
 * of magnitude faster. A digest is an identity: a record written by one and read
 * against the other would report every module changed, on every run, for as long
 * as it took somebody to notice. Nothing about that failure is loud on its own,
 * so it is loud here.
 */
describe('the digests sense takes', () => {
  const inputs = [
    '',
    'a',
    'the quick brown fox',
    // A block's text, which is what `instrument` hashes.
    'function decide(input) {\n  if (input === "alpha") return "A";\n  return "B";\n}\n',
    // Past one 64-byte block, and past the length where the padding needs a
    // second one — the two places a hand-written implementation goes wrong.
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(65),
    'x'.repeat(4096),
    // Non-ASCII, where the UTF-8 encoding is the part that has to match.
    'héllo wörld — ✓ 𝓋ariance',
    // This file, as a stand-in for any source the scanner reads.
    readFileSync(new URL(import.meta.url), 'utf8'),
  ];

  it('are the digests core takes', () => {
    for (const input of inputs) {
      expect(digestString(input)).toBe(portableString(input));
    }
  });

  it('are the digests core takes of raw bytes', () => {
    for (const input of inputs) {
      const bytes = new TextEncoder().encode(input);
      expect(digestBytes(bytes)).toBe(portableBytes(bytes));
    }
  });

  it('carry the algorithm they were taken with', () => {
    expect(digestString('a')).toMatch(/^v1:[0-9a-f]{32}$/);
  });
});
