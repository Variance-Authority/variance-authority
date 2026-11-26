import { describe, expect, it } from 'vitest';

import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { framedHeader, sections } from './format-layout.js';
import { rawRecord } from './raw-record.js';
import { LAYOUT } from './record-layout.js';

/** A coverage large enough that its region columns are packed. */
const packed = encodeTestCoverage({
  version: 3,
  instrumentation: 'fixture',
  tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
  modules: Array.from({ length: 300 }, (_, module) => ({
    file: `src/${String(module).padStart(3, '0')}.ts`,
    sourceDigest: `digest-${module}`,
    instrumented: true,
    blocks: Array.from({ length: 100 }, (_, ordinal) => ({
      ordinal, ...(ordinal === 0 ? { kind: 'module' as const } : { kind: 'function' as const, owner: 0 }), digest: `d${module}-${ordinal}`, name: `f${ordinal}`, path: `f${ordinal}`,
      startLine: ordinal + 1, endLine: ordinal + 1, source: true, testFiles: ordinal % 2 === 0 ? ['a.test.ts'] : [],
    })),
  })),
});

/** The codec tag of every run in a packed section. */
function tags(record: Uint8Array, name: string): number[] {
  const bytes = Buffer.from(record);
  const base = 4 + bytes.readUInt32LE(0);
  const { offset } = framedHeader(record)!.sections.find((section) => section.name === name)!;
  const section = bytes.subarray(base + offset);
  const count = section.readUInt32LE(0);
  return Array.from({ length: count }, (_, run) => section[4 + 4 * (count + 1) + section.readUInt32LE(4 + 4 * run)]!);
}

const packedNames = framedHeader(packed)!.sections.filter((section) => section.rows !== undefined).map((section) => section.name);

describe('rawRecord', () => {
  it('stores every packed run raw, and the record still decodes to the same coverage', () => {
    expect(packedNames.length).toBeGreaterThan(0);
    const raw = rawRecord(packed);

    for (const name of packedNames) expect(new Set(tags(raw, name))).toEqual(new Set([LAYOUT.codecs.raw]));
    expect(openTestCoverage(raw).blockDigest.length).toBe(openTestCoverage(packed).blockDigest.length);
    expect(decodeTestCoverage(raw)).toEqual(decodeTestCoverage(packed));
  });

  it('follows into a section that is itself framed', () => {
    const plain = Buffer.from(packed);
    const outer = sections({ inner: { plain, rows: plain.length, width: 1 } });
    const raw = rawRecord(outer);
    const { offset, length } = framedHeader(raw)!.sections[0]!;
    const base = 4 + Buffer.from(raw).readUInt32LE(0);

    expect(decodeTestCoverage(raw.subarray(base + offset, base + offset + length))).toEqual(decodeTestCoverage(packed));
    for (const name of packedNames) expect(new Set(tags(raw.slice(base + offset, base + offset + length), name))).toEqual(new Set([LAYOUT.codecs.raw]));
  });

  it('returns bytes that are not framed as they are', () => {
    const bytes = Buffer.from('{"not":"a record"}');

    expect(rawRecord(bytes)).toBe(bytes);
  });
});
