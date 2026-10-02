import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { caseSectionsOf, keepsCases, keepsEyes, recordedCases, sharedRecord, withCaseSections } from './case-record.js';
import { decodeExecutionIndex, encodeExecutionIndex } from './execution-format.js';
import { decodeRecordedEyes, encodeRecordedEyes } from './eyes-record.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import type { ExecutionIndex } from './execution-format.js';
import type { TestCoverage } from './index.js';

const COVERAGE: TestCoverage = {
  version: 3,
  instrumentation: 'fixture',
  commit: 'a'.repeat(40),
  tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
  modules: [],
};

const INDEX: ExecutionIndex = {
  tests: [{ id: 'test/total.test.ts > discounts', file: 'test/total.test.ts', name: 'discounts', stopped: false }],
  modules: [{
    file: 'src/total.ts',
    blocks: [{
      kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true,
      crossings: [{ test: 0, distance: 0 }],
    }],
  }],
};

const LAST = Buffer.from('{"files":["test/total.test.ts"]}\n');

let dir: string | undefined;

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function at(bytes: Uint8Array): string {
  dir = mkdtempSync(join(tmpdir(), 'case-record-'));
  const file = join(dir, 'coverage.bin');
  writeFileSync(file, bytes);
  return file;
}

describe('a record that carries its cases', () => {
  const index = encodeExecutionIndex(INDEX);
  const eyes = Buffer.from(encodeRecordedEyes({ watched: [], journals: [] }));
  const record = withCaseSections(encodeTestCoverage(COVERAGE), { index, before: index, last: LAST, eyes });

  it('reads as the coverage it carried and as the case index it carried', () => {
    expect(decodeTestCoverage(record)).toEqual(decodeTestCoverage(encodeTestCoverage(COVERAGE)));
    expect(decodeExecutionIndex(record)).toEqual(decodeExecutionIndex(index));
    expect(Buffer.from(recordedCases(record))).toEqual(index);
  });

  it('says it keeps cases from its header', () => {
    expect(keepsCases(at(record))).toBe(true);
  });

  it('crosses to another checkout with its index and without the run that is not the taker\'s', () => {
    const shared = sharedRecord(record);
    const parts = caseSectionsOf(shared);
    expect(parts.before).toBeUndefined();
    expect(parts.last).toBeUndefined();
    expect(Buffer.from(parts.index ?? [])).toEqual(index);
    expect(decodeTestCoverage(shared)).toEqual(decodeTestCoverage(record));
  });

  it('keeps its Eyes journals when it crosses, because a crossing is the same person\'s or one they made', () => {
    expect(Buffer.from(caseSectionsOf(record).eyes ?? [])).toEqual(eyes);
    expect(Buffer.from(caseSectionsOf(sharedRecord(record)).eyes ?? [])).toEqual(eyes);
  });

  it('is refused by a fold when it holds a section this build does not know, rather than losing it', () => {
    const header = record.readUInt32LE(0);
    const text = record.subarray(4, 4 + header).toString('utf8');
    const renamed = Buffer.from(record);
    renamed.write(text.replace('"cases.last"', '"eyes.lasts"'), 4, 'utf8');
    expect(() => caseSectionsOf(renamed)).toThrow(/does not know, and would drop it: eyes\.lasts/u);
    expect(() => sharedRecord(renamed)).toThrow(/eyes\.lasts/u);
    expect(() => withCaseSections(renamed, {})).toThrow(/eyes\.lasts/u);
  });
});

describe('a record that kept no cases', () => {
  const record = encodeTestCoverage(COVERAGE);

  it('says so, and so does a record that is not there', () => {
    expect(keepsCases(at(record))).toBe(false);
    expect(keepsCases(join(dir ?? tmpdir(), 'absent.bin'))).toBe(false);
  });

  it('says so when it is cut short of the length its header opens with', () => {
    expect(keepsCases(at(Buffer.from([1, 0])))).toBe(false);
    expect(keepsEyes(at(Buffer.alloc(0)))).toBe(false);
  });

  it('is handed to the index reader as it is, which refuses it on its own terms', () => {
    expect(recordedCases(record)).toBe(record);
  });

  it('crosses as it is', () => {
    expect(sharedRecord(record)).toBe(record);
  });
});

describe('a case index on its own', () => {
  it('is read as itself', () => {
    const index = encodeExecutionIndex(INDEX);
    expect(recordedCases(index)).toBe(index);
    expect(decodeExecutionIndex(index)).toEqual(decodeExecutionIndex(recordedCases(index)));
  });
});

describe('an Eyes section', () => {
  it('refuses a row that names no case and attempt, rather than keeping a journal nothing can join', () => {
    const section = (row: unknown) => Buffer.from(JSON.stringify({ version: 1, watched: [], journals: [row] }));
    expect(decodeRecordedEyes(section({ case: 'a', attempt: 1, journal: {} })).journals).toHaveLength(1);
    for (const row of [{ case: '', attempt: 1, journal: {} }, { case: 'a', attempt: 0, journal: {} }, { case: 'a', attempt: 1 }]) {
      expect(() => decodeRecordedEyes(section(row))).toThrow('holds a row that names no case and attempt');
    }
  });
});
