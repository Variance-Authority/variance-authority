import { describe, expect, it } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { layCoverage } from './format-layer.js';
import { FORMAT, LANE, NO_DURATION, UNLANED_FORMAT, sections, type Header, type Stored } from './format-layout.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';

const TESTS = ['test/alpha.test.ts', 'test/beta.test.ts'];

/** Two tests over one module; `lanes[n]` is the worker lane the runner gave test `n`. */
function coverage(lanes: readonly (number | undefined)[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: TESTS.map((file, at) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: `source:${file}` }],
      ...(lanes[at] === undefined ? {} : { lane: lanes[at] }),
    })),
    modules: [],
  };
}

function headerOf(bytes: Buffer): { header: Header; base: number } {
  const length = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.toString('utf8', 4, 4 + length).replace(/\0+$/, '')) as Header;
  return { header, base: 4 + length };
}

/** The same snapshot in the layout before lanes: its sections as stored, less `tests.lane`. */
function unlaned(bytes: Buffer): Buffer {
  const { header, base } = headerOf(bytes);
  const kept: Record<string, Stored> = {};
  for (const section of header.sections) {
    if (section.name === LANE) continue;
    const plain = bytes.subarray(base + section.offset, base + section.offset + section.length);
    kept[section.name] = { plain, rows: section.length / section.width, width: section.width };
  }
  return sections(kept, UNLANED_FORMAT);
}

describe('which worker lane ran a test file', () => {
  it('round-trips a lane, one word a test file, and a file with none reads back absent', () => {
    const written = encodeTestCoverage(coverage([2, undefined]));

    expect(decodeTestCoverage(written).tests.map((test) => [test.file, test.lane])).toEqual([
      ['test/alpha.test.ts', 2],
      ['test/beta.test.ts', undefined],
    ]);
    expect(openTestCoverage(written).testLane?.all() ?? []).toEqual(new Uint32Array([2, NO_DURATION]));
  });

  it('round-trips a record with no lane anywhere exactly as it was', () => {
    const none = coverage([undefined, undefined]);

    expect(decodeTestCoverage(encodeTestCoverage(none))).toEqual(none);
  });

  it('opens a snapshot written before lanes were recorded, as one whose runner gave none', () => {
    const before = unlaned(encodeTestCoverage(coverage([0, 1])));

    expect(openTestCoverage(before).testLane).toBeUndefined();
    expect(decodeTestCoverage(before)).toEqual(coverage([undefined, undefined]));
  });

  it('layers a run over that older snapshot into the current layout, laned only where the run laned it', () => {
    const before = unlaned(encodeTestCoverage(coverage([])));
    const whole = coverage([]);
    const run: TestCoverage = { ...whole, tests: [{ ...whole.tests[1]!, lane: 3 }], modules: [] };

    const layered = layCoverage(before, run);

    expect(headerOf(layered).header.version).toBe(FORMAT);
    expect(decodeTestCoverage(layered).tests.map((test) => [test.file, test.lane])).toEqual([
      ['test/alpha.test.ts', undefined],
      ['test/beta.test.ts', 3],
    ]);
  });
});
