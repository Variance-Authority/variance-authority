import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CHROMIUM_PROFILE, environmentKey, type SemanticSnapshot } from '@variance-authority/core/format';
import { packSnapshot, unpackSnapshot } from './packed.js';

/**
 * The two ends of the snapshot a baseline keeps.
 *
 * Every store between them carries the text without reading it, so these are
 * the only two places its shape is decided, and an unreadable one has to come
 * back as *not recorded* rather than as a tree the matcher trips over.
 */

const SNAPSHOT: SemanticSnapshot = {
  formatVersion: 1,
  subject: { id: 's', kind: 'fixture' },
  profile: CHROMIUM_PROFILE,
  environment: environmentKey({
    profile: 'chromium',
    engine: 'chromium',
    ruleset: 'r',
    allowlist: 'a',
    viewport: { width: 8, height: 8, deviceScaleFactor: 1, colorScheme: 'light' },
    fonts: [],
    conditions: {},
    assets: {},
  }),
  renderHash: 'v1:r',
  structureHash: 'v1:s',
  styleHash: 'v1:t',
  root: {
    path: '0',
    tag: 'div',
    attributes: {},
    style: {},
    children: [{ path: '0/0', tag: 'span', attributes: {}, style: {}, children: [] }],
  },
  styleProvenance: [],
  diagnostics: [],
};

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

  it('is not recorded when the text after its header will not unpack', () => {
    expect(unpackSnapshot('v1:not gzip')).toBeUndefined();
  });

  it('is not recorded when what it unpacks to is not a snapshot', () => {
    expect(unpackSnapshot(packedJson({ formatVersion: 1, root: 'html' }))).toBeUndefined();
  });

  it('is not recorded when a node below its root is not a node', () => {
    // The matcher walks every child, so one that is not a node would throw
    // there, where a missing snapshot falls back to the one tree it has.
    const damaged = { ...SNAPSHOT, root: { ...SNAPSHOT.root, children: [{ path: '0/0', tag: 'span' }] } };
    expect(unpackSnapshot(packedJson(damaged))).toBeUndefined();
  });

  it('is not recorded when it is of another format version', () => {
    // A tree of another shape, read as this one, pairs nodes by fields that
    // mean something else.
    expect(unpackSnapshot(packedJson({ ...SNAPSHOT, formatVersion: 2 }))).toBeUndefined();
  });
});
