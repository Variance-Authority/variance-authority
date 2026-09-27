import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTestCoverageFile } from './coverage-file.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { layerTestCoverage } from './format-layer.js';
import {
  DURATION,
  FORMAT,
  NO_DURATION,
  UNTIMED_FORMAT,
  durationWord,
  sections,
  type Header,
  type Stored,
} from './format-layout.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';

const TESTS = ['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts'];

/** Three tests over one module; `durations[n]` is what the runner reported for test `n`. */
function coverage(durations: readonly (number | undefined)[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: TESTS.map((file, at) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: `source:${file}` }],
      ...(durations[at] === undefined ? {} : { duration: durations[at] }),
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
    // Every section of a snapshot this small is stored as it is, never as runs.
    expect(section.rows).toBeUndefined();
    const plain = bytes.subarray(base + section.offset, base + section.offset + section.length);
    kept[section.name] = { plain, rows: section.length / section.width, width: section.width };
  }
  return sections(kept, version);
}

describe('what the runner said a test file cost', () => {
  it('is stored to the whole millisecond, and a test the runner did not time reads back untimed', () => {
    const written = encodeTestCoverage(coverage([12.4, undefined, 0]));

    expect(headerOf(written).header.version).toBe(FORMAT);
    expect(decodeTestCoverage(written).tests.map((test) => test.duration)).toEqual([12, undefined, 0]);
    expect(openTestCoverage(written).testDuration?.all()).toEqual(Uint32Array.of(12, NO_DURATION, 0));
  });

  it('stores what no runner could have meant as untimed, never as zero', () => {
    expect([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 40].map(durationWord))
      .toEqual([NO_DURATION, NO_DURATION, NO_DURATION, NO_DURATION, NO_DURATION]);
    expect(durationWord(0.4)).toBe(0);
  });

  it('opens a snapshot written before durations were recorded, as one whose runner timed nothing', async () => {
    const untimed = relaid(encodeTestCoverage(coverage([5, 6, 7])), UNTIMED_FORMAT, [DURATION]);

    expect(openTestCoverage(untimed).testDuration).toBeUndefined();
    const decoded = decodeTestCoverage(untimed);
    expect(decoded.tests.map((test) => test.duration)).toEqual([undefined, undefined, undefined]);
    expect(decoded).toEqual(coverage([]));

    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-untimed-'));
    try {
      const file = resolve(directory, 'coverage.bin');
      await writeFile(file, untimed);
      expect(isTestCoverageFile(file)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('layers a run over that older snapshot into the current layout, timing only what the run timed', () => {
    const untimed = relaid(encodeTestCoverage(coverage([])), UNTIMED_FORMAT, [DURATION]);
    const run: TestCoverage = { ...coverage([]), tests: [{ ...coverage([]).tests[1]!, duration: 21.7 }] };

    const layered = layerTestCoverage(untimed, run);

    expect(headerOf(layered).header.version).toBe(FORMAT);
    expect(decodeTestCoverage(layered).tests.map((test) => [test.file, test.duration])).toEqual([
      ['test/alpha.test.ts', undefined],
      ['test/beta.test.ts', 22],
      ['test/gamma.test.ts', undefined],
    ]);
  });

  it('refuses a current-layout snapshot that lacks the duration section', () => {
    const lacking = relaid(encodeTestCoverage(coverage([1, 2, 3])), FORMAT, [DURATION]);

    expect(() => openTestCoverage(lacking)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('refuses a duration section that does not hold one row a test', () => {
    const written = encodeTestCoverage(coverage([1, 2, 3]));
    const { header, base } = headerOf(written);
    const kept: Record<string, Stored> = {};
    for (const section of header.sections) {
      const plain = written.subarray(base + section.offset, base + section.offset + section.length);
      kept[section.name] = section.name === DURATION
        ? { plain: Buffer.from(Uint32Array.of(1, 2).buffer), rows: 2, width: 4 }
        : { plain, rows: section.length / section.width, width: section.width };
    }

    expect(() => openTestCoverage(sections(kept))).toThrow(/not a variance-authority test coverage artifact/);
  });
});
