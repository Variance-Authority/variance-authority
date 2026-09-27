import { describe, expect, it } from 'vitest';
import { digestFileName, digestOfFileName, fileNameFor } from './hash.js';

/**
 * A digest spelled as a path segment, and read back from one.
 *
 * The digest's own spelling carries a colon, which NTFS refuses and
 * `actions/upload-artifact` will not carry. These are the two directions of the
 * one rule every writer of a digest-named path goes through.
 */

const DIGEST = 'v1:0123456789abcdef0123456789abcdef';

describe('digestFileName', () => {
  it('spells a digest with no character a filesystem refuses', () => {
    expect(digestFileName(DIGEST)).toBe('v1-0123456789abcdef0123456789abcdef');
  });

  it('is the spelling `fileNameFor` ends a truncated name with', () => {
    expect(fileNameFor('x'.repeat(400))).toMatch(/~v1-[0-9a-f]{32}$/);
  });
});

describe('digestOfFileName', () => {
  it('reads back the digest a name was spelled from', () => {
    expect(digestOfFileName(digestFileName(DIGEST))).toBe(DIGEST);
  });

  it('reads the raw digest too, which is how a directory was named before', () => {
    expect(digestOfFileName(DIGEST)).toBe(DIGEST);
  });

  it('reads nothing into a name that spells no digest', () => {
    for (const name of ['by-document', 'v1-0123', 'v2-0123456789abcdef0123456789abcdef', `${DIGEST}.json`]) {
      expect(digestOfFileName(name)).toBeUndefined();
    }
  });
});
