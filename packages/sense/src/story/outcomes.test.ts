import { describe, expect, it } from 'vitest';
import { lineValue } from '../test-selection/case-lines.js';
import type { ReadRegion, Reading } from '../test-selection/case-readings.js';
import { compareOutcomes } from './outcomes.js';

const WIRE = { file: 'src/page.ts', name: 'wire', path: 'entry', startLine: 1, endLine: 3 };
const HANDLE = { file: 'src/page.ts', name: 'handle', path: 'entry', startLine: 5, endLine: 8 };
const ERROR = { file: 'src/page.ts', name: 'handle', path: 'if#0/then', startLine: 6, endLine: 6 };

type At = typeof WIRE;
const crossed = (region: At, line: number | null, hook = false): ReadRegion =>
  [region.file, region.name, region.path, region.startLine, region.endLine, line === null ? null : lineValue(line, hook)];
const reading = (stopped: boolean, regions: ReadRegion[], count = 1): Reading => ({ count, stopped, regions });
const compared = (readings: Reading[]) => compareOutcomes({ file: 'test/page.spec.ts', name: 'clicks', readings });

describe('compareOutcomes', () => {
  it('tells a region charged to a later line on every failing reading', () => {
    const comparison = compared([
      reading(false, [crossed(WIRE, 3), crossed(HANDLE, 7)], 2),
      reading(true, [crossed(HANDLE, 7), crossed(WIRE, 9), crossed(ERROR, 7)]),
      reading(true, [crossed(HANDLE, 7), crossed(WIRE, 9), crossed(ERROR, 7)]),
    ]);

    expect(comparison).toEqual({
      file: 'test/page.spec.ts',
      name: 'clicks',
      passed: 2,
      threw: 2,
      onlyPassed: [],
      onlyThrew: [ERROR],
      moved: [{ region: WIRE, passed: { line: 3 }, threw: { line: 9 } }],
      unsteady: 0,
      single: false,
    });
  });

  it('counts what moves between readings of one outcome and tells nothing of it', () => {
    const comparison = compared([
      reading(false, [crossed(WIRE, 3), crossed(HANDLE, 7)]),
      reading(false, [crossed(WIRE, 4), crossed(HANDLE, 7)]),
      reading(true, [crossed(WIRE, 3), crossed(HANDLE, 7)]),
      reading(true, [crossed(WIRE, 4), crossed(HANDLE, 7), crossed(ERROR, 7)]),
    ]);

    expect(comparison).toMatchObject({ onlyPassed: [], onlyThrew: [], moved: [], unsteady: 2, single: false });
  });

  it('tells a region reached on every passing reading and on no failing one, and one a hook reached on one side only', () => {
    const comparison = compared([
      reading(false, [crossed(WIRE, 3), crossed(HANDLE, 7)], 2),
      reading(true, [crossed(WIRE, 3, true)], 2),
    ]);

    expect(comparison).toMatchObject({
      onlyPassed: [HANDLE],
      moved: [{ region: WIRE, passed: { line: 3 }, threw: { line: 3, hook: true } }],
    });
  });

  it('tells a region drained without a line on every failing reading', () => {
    const comparison = compared([
      reading(false, [crossed(HANDLE, 7)], 2),
      reading(true, [crossed(HANDLE, null)], 2),
    ]);

    expect(comparison?.moved).toEqual([{ region: HANDLE, passed: { line: 7 }, threw: {} }]);
  });

  it('separates nothing in a record written without lines but where the outcomes went', () => {
    const comparison = compared([
      reading(false, [crossed(WIRE, null), crossed(HANDLE, null)], 2),
      reading(true, [crossed(WIRE, null)], 2),
    ]);

    expect(comparison).toMatchObject({ onlyPassed: [HANDLE], moved: [], unsteady: 0 });
  });

  it('says when one outcome holds a single run', () => {
    expect(compared([reading(false, [crossed(WIRE, 3)], 4), reading(true, [])])?.single).toBe(true);
  });

  it('compares nothing when every reading kept has one outcome', () => {
    expect(compared([reading(false, [crossed(WIRE, 3)]), reading(false, [crossed(WIRE, 4)])])).toBeUndefined();
  });
});
