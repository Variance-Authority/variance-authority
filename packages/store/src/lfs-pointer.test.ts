import { describe, expect, it } from 'vitest';
import { isLfsPointer, LFS_POINTER_HEAD_BYTES } from './lfs-pointer.js';

const POINTER =
  'version https://git-lfs.github.com/spec/v1\n' +
  'oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\n' +
  'size 12345\n';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('the head of a file that git-lfs did not smudge', () => {
  it('is a pointer from its first LFS_POINTER_HEAD_BYTES bytes alone', () => {
    const head = Buffer.from(POINTER).subarray(0, LFS_POINTER_HEAD_BYTES);

    expect(isLfsPointer(head)).toBe(true);
  });

  it('is not a pointer one byte short of LFS_POINTER_HEAD_BYTES', () => {
    const head = Buffer.from(POINTER).subarray(0, LFS_POINTER_HEAD_BYTES - 1);

    expect(isLfsPointer(head)).toBe(false);
  });

  it('is not a pointer when it is a PNG', () => {
    expect(isLfsPointer(PNG)).toBe(false);
  });
});
