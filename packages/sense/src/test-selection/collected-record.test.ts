import { describe, expect, it } from 'vitest';
import { caseSectionsOf, withCaseSections } from './case-record.js';
import { collectedRecord } from './collected-record.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { encodeRecordedEyes, readableEyes } from './eyes-record.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import type { CoverageBlock, TestCoverage } from './index.js';

const KEPT = 'test/kept.test.ts';
const FOREIGN = 'test/elsewhere.chromium.test.ts';

const block = (name: string, testFiles: readonly string[]): CoverageBlock => ({
  ordinal: 0, kind: 'module', digest: `digest-${name}`, name, path: name, source: true, startLine: 1, endLine: 1, testFiles,
});

/** A record a suite carried from before it stopped collecting `FOREIGN`. */
const coverage: TestCoverage = {
  version: 3,
  instrumentation: 'fixture',
  commit: 'a'.repeat(40),
  tests: [
    { file: FOREIGN, complete: false, preconditions: [{ name: 'browser', digest: 'chromium' }] },
    { file: KEPT, complete: true, preconditions: [] },
  ],
  modules: [
    { file: 'src/both.ts', sourceDigest: 'both', instrumented: true, blocks: [{ ...block('both', [FOREIGN, KEPT]), loadedBy: [FOREIGN] }] },
    { file: 'src/foreign.ts', sourceDigest: 'foreign', instrumented: true, blocks: [block('foreign', [FOREIGN])] },
    { file: 'src/unread.ts', sourceDigest: 'unread', instrumented: false, blocks: [] },
  ],
};

/** The cases of both files, each calling the module they share. */
function cases(): Buffer {
  const tests = [`${FOREIGN} > opens`, `${KEPT} > counts`].map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  return encodeSetExecutionIndex({
    tests,
    modules: [{
      file: 'src/both.ts',
      blocks: [{ kind: 'module', name: 'both', path: 'both', startLine: 1, endLine: 1, source: true }],
      called: Uint32Array.of(sets.intern([0, 1])),
      loaded: Uint8Array.of(0),
    }],
    sets: sets.pool(),
  });
}

const eyes = encodeRecordedEyes({
  watched: [`${FOREIGN} > opens`, `${KEPT} > counts`],
  journals: [{ case: `${FOREIGN} > opens`, attempt: 1, journal: {} }, { case: `${KEPT} > counts`, attempt: 1, journal: {} }],
});

describe('collectedRecord', () => {
  it('retires the rows, crossings, cases and journals of a test file the suite no longer collects', () => {
    const record = withCaseSections(encodeTestCoverage(coverage), { index: cases(), eyes });

    const { record: collected, retired } = collectedRecord(record, new Set([KEPT]));

    expect(retired).toEqual([FOREIGN]);
    const decoded = decodeTestCoverage(collected);
    expect(decoded.tests.map((test) => test.file)).toEqual([KEPT]);
    // A module only the retired file entered keeps its row with no test on it,
    // as a merge leaves a module whose last test it retired.
    expect(decoded.modules.map((module) => [module.file, module.blocks.map((row) => row.testFiles)])).toEqual([
      ['src/both.ts', [[KEPT]]],
      ['src/foreign.ts', [[]]],
      ['src/unread.ts', []],
    ]);
    expect(decoded.modules[0]!.blocks[0]).not.toHaveProperty('loadedBy');
    const sections = caseSectionsOf(collected);
    expect(decodeExecutionIndex(sections.index!).tests.map((test) => test.id)).toEqual([`${KEPT} > counts`]);
    expect(readableEyes(sections.eyes)?.journals.map((row) => row.case)).toEqual([`${KEPT} > counts`]);
  });

  it('refuses a list that names none of the test files the record holds, rather than emptying it', () => {
    const record = withCaseSections(encodeTestCoverage(coverage), { index: cases(), eyes });

    expect(() => collectedRecord(record, new Set(['test/other.test.ts']))).toThrow(
      `the list names none of the 2 test file(s) the record holds, ${FOREIGN} among them, so every one would be retired`,
    );
  });

  it('hands back the record it was given when the suite collects every test file it holds', () => {
    const record = withCaseSections(encodeTestCoverage(coverage), { index: cases(), eyes });

    const { record: collected, retired } = collectedRecord(record, new Set([KEPT, FOREIGN]));

    expect(retired).toEqual([]);
    expect(collected).toBe(record);
  });
});
