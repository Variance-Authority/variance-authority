import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withCaseSections } from './case-record.js';
import { encodeExecutionIndex } from './execution-format.js';
import { encodeTestCoverage } from './format.js';
import {
  BLOCK_KINDS,
  caseSectionsAt,
  encodeAsSetExecutionIndex,
  openCoverageFile,
  openSetColumns,
  type CoverageBlock,
  type ExecutionIndex,
  type StringTable,
  type TestCoverage,
} from './index.js';

const TEST = 'test/total.test.ts';

const region = (kind: CoverageBlock['kind'], name: string, loadedBy?: readonly string[]): CoverageBlock => ({
  ordinal: 0, kind, digest: `digest-${name}`, name, path: name, source: true, startLine: 1, endLine: 12, testFiles: [TEST],
  ...(loadedBy === undefined ? {} : { loadedBy }),
});

const COVERAGE: TestCoverage = {
  version: 3,
  instrumentation: 'fixture',
  commit: 'a'.repeat(40),
  tests: [{ file: TEST, complete: true, preconditions: [] }],
  modules: [{
    file: 'src/total.ts',
    sourceDigest: 'total',
    instrumented: true,
    blocks: [region('module', 'total', [TEST]), region('function', 'applyDiscount')],
  }],
};

const INDEX: ExecutionIndex = {
  tests: [{ id: `${TEST} > discounts`, file: TEST, name: 'discounts', stopped: false }],
  modules: [{
    file: 'src/total.ts',
    blocks: [{
      kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 3, endLine: 5, source: true,
      crossings: [{ test: 0, distance: 0 }],
    }],
  }],
};

let dir: string | undefined;

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function recordOf(index: Uint8Array): string {
  dir = mkdtempSync(join(tmpdir(), 'record-columns-'));
  const file = join(dir, 'coverage.bin');
  writeFileSync(file, withCaseSections(encodeTestCoverage(COVERAGE), { index }));
  return file;
}

/** The same index with one section dropped from its header, as a writer that never made it would leave it. */
function without(bytes: Uint8Array, name: string): Buffer {
  const framed = Buffer.from(bytes);
  const headerLength = framed.readUInt32LE(0);
  const header = JSON.parse(framed.toString('utf8', 4, 4 + headerLength).replace(/\0+$/u, '')) as {
    version: number;
    sections: { name: string }[];
  };
  const sections = header.sections.filter((section) => section.name !== name);
  expect(sections.length).toBe(header.sections.length - 1);
  const older = Buffer.from(JSON.stringify({ version: header.version, sections }).padEnd(headerLength, '\0'), 'utf8');
  return Buffer.concat([framed.subarray(0, 4), older, framed.subarray(4 + headerLength)]);
}

function text(strings: StringTable, id: number): string {
  return new TextDecoder().decode(strings.blob.subarray(strings.offsets[id], strings.offsets[id + 1]));
}

describe('a record read where it lies, without decoding it', () => {
  it('names each region of the snapshot by its position in BLOCK_KINDS, and the test files that loaded its top level', () => {
    const { view, close } = openCoverageFile(recordOf(encodeAsSetExecutionIndex(INDEX)));
    try {
      const first = view.moduleBlocks.at(0);
      const kinds = [first, first + 1].map((block) => BLOCK_KINDS[view.blockKind.at(block)]);
      expect(kinds).toEqual(['module', 'function']);
      const loaders = view.crossings.members(view.blockLoadedSet.at(first));
      expect([...loaders].map((test) => view.string(view.testPath.at(test)))).toEqual([TEST]);
    } finally {
      close();
    }
  });

  it('opens the case index as columns: whose each case is, that it finished, and which cases crossed each region', () => {
    const columns = openSetColumns(caseSectionsAt(recordOf(encodeAsSetExecutionIndex(INDEX)), ['index']).index!);
    expect(columns).toBeDefined();
    const { strings, testFile, testStopped, moduleFile, moduleBlocks, blockKind, blockCalled, sets } = columns!;
    expect(text(strings, testFile[0])).toBe(TEST);
    expect(testStopped?.[0]).toBe(1);
    expect(text(strings, moduleFile[0])).toBe('src/total.ts');
    const block = moduleBlocks[0];
    expect(text(strings, blockKind[block])).toBe('function');
    expect([...sets.members(blockCalled[block])]).toEqual([0]);
  });

  it('leaves how each case settled absent from an index that never said, and opens the rest as before', () => {
    const columns = openSetColumns(without(encodeAsSetExecutionIndex(INDEX), 'tests.stopped'));
    expect(columns).toBeDefined();
    const { strings, testFile, testStopped, moduleBlocks, blockKind, blockCalled, sets } = columns!;
    expect(testStopped).toBeUndefined();
    expect(text(strings, testFile[0])).toBe(TEST);
    const block = moduleBlocks[0];
    expect(text(strings, blockKind[block])).toBe('function');
    expect([...sets.members(blockCalled[block])]).toEqual([0]);
  });

  it('hands back nothing for a case index in the row spelling, which has no columns to open', () => {
    expect(openSetColumns(encodeExecutionIndex(INDEX))).toBeUndefined();
  });
});
