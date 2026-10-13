import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SemanticSnapshot } from '@variance-authority/core/format';
import { packSnapshot, unpackSnapshot } from './packed.js';

/**
 * The two ends of the snapshot a baseline keeps.
 *
 * Every store between them carries the text without reading it, so these are
 * the only two places its shape is decided, and an unreadable one has to come
 * back as *not recorded* rather than as a tree the matcher trips over.
 */

const SNAPSHOT = {
  formatVersion: 1,
  subject: { id: 's', kind: 'fixture' },
  root: { path: '0', tag: 'div', attributes: {}, style: {}, children: [] },
} as unknown as SemanticSnapshot;

const packedJson = (value: unknown) => `v1:${gzipSync(JSON.stringify(value)).toString('base64')}`;

describe('a packed snapshot', () => {
  it('unpacks to the snapshot that was packed', () => {
    expect(unpackSnapshot(packSnapshot(SNAPSHOT))).toEqual(SNAPSHOT);
  });

  it('is gzip in base64, after a header that names its format version', () => {
    expect(packSnapshot(SNAPSHOT).startsWith('v1:H4sI')).toBe(true);
  });

  it('is not recorded when it carries no header', () => {
    // Every store answers "kept a snapshot" from the header alone, so text
    // without one must not unpack here either.
    expect(unpackSnapshot(packedJson(SNAPSHOT).slice('v1:'.length))).toBeUndefined();
  });

  it('is not recorded when there is none', () => {
    expect(unpackSnapshot(undefined)).toBeUndefined();
  });

  it('is not recorded when the text will not unpack', () => {
    expect(unpackSnapshot('not gzip')).toBeUndefined();
  });

  it('is not recorded when what it unpacks to is not a snapshot', () => {
    expect(unpackSnapshot(packedJson({ formatVersion: 1, root: 'html' }))).toBeUndefined();
  });

  it('is not recorded when it is of another format version', () => {
    // A tree of another shape, read as this one, pairs nodes by fields that
    // mean something else.
    expect(unpackSnapshot(packedJson({ ...SNAPSHOT, formatVersion: 2 }))).toBeUndefined();
  });
});
