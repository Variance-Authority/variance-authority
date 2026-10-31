import { describe, expect, it } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { layCoverage } from './format-layer.js';
import {
  BLOB,
  DURATION,
  FORMAT,
  NO_DURATION,
  PHASES,
  UNKEYED_FORMAT,
  UNPHASED_FORMAT,
  UNTIMED_FORMAT,
  readableFormat,
  sections,
  type Header,
  type Stored,
} from './format-layout.js';
import { openTestCoverage } from './format-view.js';
import type { FilePhases, TestCoverage } from './index.js';

const TESTS = ['test/alpha.test.ts', 'test/beta.test.ts'];

/** Two tests over one module; `phases[n]` is what the runner reported for test `n`. */
function coverage(phases: readonly (FilePhases | undefined)[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: TESTS.map((file, at) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: `source:${file}` }],
      ...(phases[at] === undefined ? {} : { phases: phases[at] }),
    })),
    modules: [{
      file: 'src/decide.ts',
      sourceDigest: 'source:src/decide.ts',
      instrumented: true,
      blocks: [{
        ordinal: 0,
        kind: 'module',
        digest: 'block:src/decide.ts',
        name: '',
        path: 'module',
        startLine: 1,
        endLine: 3,
        source: true,
        testFiles: [...TESTS],
      }],
    }],
  };
}

function headerOf(bytes: Buffer): { header: Header; base: number } {
  const length = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.toString('utf8', 4, 4 + length).replace(/\0+$/, '')) as Header;
  return { header, base: 4 + length };
}

/** The same snapshot in another layout: its sections copied as stored, less the ones `without` names. */
function relaid(bytes: Buffer, version: number, without: readonly string[]): Buffer {
  const { header, base } = headerOf(bytes);
  const kept: Record<string, Stored> = {};
  for (const section of header.sections) {
    if (without.includes(section.name)) continue;
    const plain = bytes.subarray(base + section.offset, base + section.offset + section.length);
    kept[section.name] = { plain, rows: section.length / section.width, width: section.width };
  }
  return sections(kept, version);
}

describe('what the runner said a test file spent, phase by phase', () => {
  it('is stored per phase to the whole millisecond, and a phase the runner did not report reads back absent', () => {
    const written = encodeTestCoverage(coverage([{ prepare: 4.2, environment: 0, setup: 21, collect: 530.6, cases: 12 }, { collect: 9 }]));

    expect(headerOf(written).header.version).toBe(FORMAT);
    expect(decodeTestCoverage(written).tests.map((test) => test.phases)).toEqual([
      { prepare: 4, environment: 0, setup: 21, collect: 531, cases: 12 },
      { collect: 9 },
    ]);
    expect(openTestCoverage(written).testPhases?.all()).toEqual(Uint32Array.of(
      4, 0, 21, 531, 12,
      NO_DURATION, NO_DURATION, NO_DURATION, 9, NO_DURATION,
    ));
  });

  it('leaves a test with no phase reported without phases, never with zeroes', () => {
    expect(decodeTestCoverage(encodeTestCoverage(coverage([]))).tests.map((test) => test.phases))
      .toEqual([undefined, undefined]);
  });

  it('opens a snapshot written before phases were recorded, as one whose runner reported none', () => {
    const unphased = relaid(encodeTestCoverage(coverage([{ collect: 5 }, { collect: 6 }])), UNPHASED_FORMAT, [PHASES, BLOB]);

    expect(openTestCoverage(unphased).testPhases).toBeUndefined();
    expect(decodeTestCoverage(unphased)).toEqual(coverage([]));
  });

  it('layers a run over that older snapshot into the current layout, with phases only where the run reported them', () => {
    const unphased = relaid(encodeTestCoverage(coverage([])), UNPHASED_FORMAT, [PHASES, BLOB]);
    const whole = coverage([]);
    const run: TestCoverage = { ...whole, tests: [{ ...whole.tests[1]!, phases: { setup: 3, collect: 40 } }], modules: [] };

    const layered = layCoverage(unphased, run);

    expect(headerOf(layered).header.version).toBe(FORMAT);
    expect(decodeTestCoverage(layered).tests.map((test) => [test.file, test.phases])).toEqual([
      ['test/alpha.test.ts', undefined],
      ['test/beta.test.ts', { setup: 3, collect: 40 }],
    ]);
  });

  it('carries the phases of a test the run did not rerun', () => {
    const held = encodeTestCoverage(coverage([{ collect: 70 }, { collect: 80 }]));
    const whole = coverage([]);
    const run: TestCoverage = { ...whole, tests: [{ ...whole.tests[1]!, phases: { collect: 12 } }], modules: [] };

    expect(decodeTestCoverage(layCoverage(held, run)).tests.map((test) => test.phases)).toEqual([
      { collect: 70 },
      { collect: 12 },
    ]);
  });

  it('is read in every layout the reader opens, and only those', () => {
    const versions = [UNTIMED_FORMAT - 1, UNTIMED_FORMAT, UNPHASED_FORMAT, UNKEYED_FORMAT, FORMAT, FORMAT + 1];
    const laysOver = (version: number): boolean => {
      const without = version === FORMAT ? [] : version === UNKEYED_FORMAT ? [BLOB] : version === UNTIMED_FORMAT ? [DURATION, PHASES, BLOB] : [PHASES, BLOB];
      try {
        layCoverage(relaid(encodeTestCoverage(coverage([])), version, without), coverage([]));
        return true;
      } catch {
        return false;
      }
    };

    expect(versions.map(laysOver)).toEqual(versions.map(readableFormat));
    expect(versions.map(laysOver)).toEqual([false, true, true, true, true, false]);
  });

  it('refuses a current-layout snapshot that lacks the phases section', () => {
    const lacking = relaid(encodeTestCoverage(coverage([])), FORMAT, [PHASES]);

    expect(() => openTestCoverage(lacking)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('refuses a phases section that does not hold five words a test', () => {
    const written = encodeTestCoverage(coverage([]));
    const { header, base } = headerOf(written);
    const kept: Record<string, Stored> = {};
    for (const section of header.sections) {
      const plain = written.subarray(base + section.offset, base + section.offset + section.length);
      kept[section.name] = section.name === PHASES
        ? { plain: Buffer.from(Uint32Array.of(1, 2, 3, 4).buffer), rows: 4, width: 4 }
        : { plain, rows: section.length / section.width, width: section.width };
    }

    expect(() => openTestCoverage(sections(kept))).toThrow(/not a variance-authority test coverage artifact/);
  });
});
