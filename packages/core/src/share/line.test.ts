import { describe, expect, it } from 'vitest';
import {
  decodeManifest,
  encodeManifest,
  entryDigest,
  entryProblem,
  linePath,
  manifestPaths,
  parseEntryName,
  sameSlot,
  type LineManifest,
} from './line.js';

const DIGEST = 'a'.repeat(64);
const IMAGE = 'b'.repeat(64);
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('parseEntryName', () => {
  it('reads a family, a version and a qualifier', () => {
    expect(parseEntryName('report-v1')).toEqual({ family: 'report', version: 1 });
    expect(parseEntryName('suite-v12/web')).toEqual({ family: 'suite', version: 12, qualifier: 'web' });
    expect(parseEntryName('suite-index-v1')).toEqual({ family: 'suite-index', version: 1 });
  });

  it('refuses a name without a version, a zero version, or a nested qualifier', () => {
    expect(parseEntryName('report')).toBeUndefined();
    expect(parseEntryName('report-v0')).toBeUndefined();
    expect(parseEntryName('suite-v1/a/b')).toBeUndefined();
  });

  it('puts two versions of one suite in one slot, and two suites in two', () => {
    expect(sameSlot(parseEntryName('suite-v1/web')!, parseEntryName('suite-v2/web')!)).toBe(true);
    expect(sameSlot(parseEntryName('suite-v1/web')!, parseEntryName('suite-v1/app')!)).toBe(false);
  });
});

describe('linePath', () => {
  it('keeps the branch name as segments under its kind', () => {
    expect(linePath({ kind: 'mainline', name: 'release/2.0' })).toBe('mainline/release/2.0');
    expect(linePath({ kind: 'branch', name: 'feat/a b' })).toBe('branch/feat/a-b');
  });

  it('never leaves an empty segment or a parent reference', () => {
    expect(linePath({ kind: 'branch', name: '../..' })).toBe('branch/unnamed');
  });
});

describe('the manifest', () => {
  const manifest: LineManifest = {
    format: 1,
    entries: [
      { name: 'suite-v1/web', commit: 'c0ffee', images: [IMAGE, DIGEST], digest: DIGEST, size: 3 },
      { name: 'report-v1', commit: 'c0ffee', head: 'beef', digest: DIGEST, size: 3 },
    ],
  };

  it('round-trips, sorted by code unit', () => {
    const decoded = decodeManifest(encodeManifest(manifest));
    expect(decoded).toEqual({
      format: 1,
      entries: [
        { name: 'report-v1', commit: 'c0ffee', head: 'beef', digest: DIGEST, size: 3 },
        { name: 'suite-v1/web', commit: 'c0ffee', images: [DIGEST, IMAGE], digest: DIGEST, size: 3 },
      ],
    });
  });

  it('is byte-stable whatever order it was built in', () => {
    const reversed = { format: 1 as const, entries: [...manifest.entries].reverse() };
    expect(encodeManifest(reversed)).toEqual(encodeManifest(manifest));
  });

  it('answers a newer format as newer, not as broken', () => {
    expect(decodeManifest(ascii('{"format":2,"entries":[]}'))).toEqual({ kind: 'newer', names: ['manifest format 2'] });
  });

  it('answers a malformed one as unreadable', () => {
    expect(decodeManifest(ascii('nope'))).toMatchObject({ kind: 'unreadable' });
    expect(decodeManifest(ascii('{"format":1,"entries":[{"name":"x"}]}'))).toMatchObject({ kind: 'unreadable' });
  });

  it('names every blob it holds, once', () => {
    expect(manifestPaths(manifest)).toEqual([`entries/${DIGEST}`, `images/${DIGEST}`, `images/${IMAGE}`]);
  });
});

describe('entryProblem', () => {
  it('passes a well-formed entry and names what is wrong with the rest', () => {
    const bytes = ascii('{}');
    expect(entryProblem({ name: 'report-v1', commit: 'c0ffee', bytes })).toBeUndefined();
    expect(entryProblem({ name: 'report', commit: 'c0ffee', bytes })).toMatch(/not <family>/);
    expect(entryProblem({ name: 'report-v1', commit: 'main', bytes })).toMatch(/not a commit/);
    expect(entryProblem({ name: 'report-v1', commit: 'c0ffee', images: ['x'], bytes })).toMatch(/sha-256/);
    expect(entryDigest(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });
});
