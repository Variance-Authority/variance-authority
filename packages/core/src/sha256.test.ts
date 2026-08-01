import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256.js';

/**
 * `node:crypto` appears here and nowhere in `src` outside this file. It is the
 * oracle, not the implementation: the point is to prove the portable version
 * agrees with a known-correct one, which requires having one to compare against.
 */
describe('sha256Hex', () => {
  it('matches the FIPS 180-4 published vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with node:crypto across the block-boundary cases', () => {
    // 55/56/57 and 63/64/65 bytes straddle the padding and block boundaries,
    // where a length-arithmetic error hides from short-input tests.
    const lengths = [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1000];

    for (const length of lengths) {
      const input = 'a'.repeat(length);
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });

  it('agrees with node:crypto on multi-byte and astral characters', () => {
    for (const input of ['héllo', '日本語', '🎯 emoji', 'é combining', '\u{1f600}'.repeat(50)]) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });

  it('substitutes a lone surrogate the same way TextEncoder does', () => {
    // A malformed string must not produce two different digests on two runtimes.
    expect(sha256Hex('\ud800')).toBe(sha256Hex('�'));
    expect(sha256Hex('a\udc00b')).toBe(sha256Hex('a�b'));
  });
});
