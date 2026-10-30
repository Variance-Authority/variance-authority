import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoveringSuites } from './covering-suites.js';
import { marksOf } from './covering-marks.js';

/**
 * The editors' fixture is this function's input and its output: both plugins
 * paint `marks` as they read it there, so the answer they are tested on is the
 * one the CLI gives.
 */
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../editors/fixtures/covering-suites.json'), 'utf8')) as CoveringSuites;

const test = (id: string, loaded?: true) => ({ id, file: `${id}.test.ts`, name: id, stopped: false, distance: 0, ...(loaded ? { loaded } : {}) });
const unit = { suite: 'unit', kind: 'unit', from: 'u' } as const;
const e2e = { suite: 'checkout', kind: 'e2e', from: 'c' } as const;

describe('the marks of a file every declared suite answered about', () => {
  it('are the ones the editors fixture paints', () => {
    expect(marksOf(fixture.suites)).toEqual(fixture.marks);
  });

  it('read a line two suites ran as the cases of both did, so neither suite alone decides it', () => {
    const marks = marksOf([
      { ...unit, ranges: [{ startLine: 1, endLine: 4, tests: [], stopped: [], state: 'unwalked' }] },
      { ...e2e, ranges: [{ startLine: 3, endLine: 6, tests: [test('pays')], stopped: [], state: 'alone' }] },
    ]);
    expect(marks).toEqual([
      { startLine: 1, endLine: 2, state: 'unwalked', suites: ['unit'] },
      { startLine: 3, endLine: 4, state: 'alone', suites: ['unit', 'checkout'] },
      { startLine: 5, endLine: 6, state: 'alone', suites: ['checkout'] },
    ]);
  });

  it('read one case in each of two suites as two cases', () => {
    const range = (id: string) => ({ startLine: 1, endLine: 2, tests: [test(id)], stopped: [], state: 'alone' as const });
    expect(marksOf([{ ...unit, ranges: [range('a')] }, { ...e2e, ranges: [range('b')] }]))
      .toEqual([{ startLine: 1, endLine: 2, state: 'walked', suites: ['unit', 'checkout'] }]);
  });

  it('read one declared case two suites both ran as one case, whatever id each record gave it', () => {
    const range = (id: string) => ({ startLine: 1, endLine: 2, tests: [{ ...test('pays'), id }], stopped: [], state: 'alone' as const });
    const chromium = { suite: 'chromium', kind: 'e2e', from: 'c' } as const;
    const firefox = { suite: 'firefox', kind: 'e2e', from: 'f' } as const;
    expect(marksOf([{ ...chromium, ranges: [range('1')] }, { ...firefox, ranges: [range('7')] }]))
      .toEqual([{ startLine: 1, endLine: 2, state: 'alone', suites: ['chromium', 'firefox'] }]);
  });

  it('leave the state out where one suite could not tell whether a case stopped', () => {
    expect(marksOf([
      { ...unit, ranges: [{ startLine: 1, endLine: 1, tests: [], state: 'unwalked', stopped: [] }] },
      { ...e2e, ranges: [{ startLine: 1, endLine: 1, tests: [] }] },
    ])).toEqual([{ startLine: 1, endLine: 1, suites: ['unit', 'checkout'] }]);
  });

  it('read a case one suite ran in another text as not known on the lines, unless another suite says it called in', () => {
    const flagged = { ...unit, ranges: [{ startLine: 1, endLine: 2, tests: [], stopped: [], overwritten: [test('pays')] }] };
    const other = (tests: readonly ReturnType<typeof test>[]) =>
      ({ ...e2e, ranges: [{ startLine: 1, endLine: 2, tests, stopped: [], ...(tests.length === 0 ? { state: 'unwalked' as const } : {}) }] });
    expect(marksOf([flagged, other([])])).toEqual([{ startLine: 1, endLine: 2, suites: ['unit', 'checkout'] }]);
    expect(marksOf([flagged, other([test('pays')])])).toEqual([{ startLine: 1, endLine: 2, state: 'alone', suites: ['unit', 'checkout'] }]);
    expect(marksOf([flagged, other([test('ships')])])).toEqual([{ startLine: 1, endLine: 2, state: 'walked', suites: ['unit', 'checkout'] }]);
  });

  it('are absent when no suite answered with ranges, as a question about one line', () => {
    expect(marksOf([{ ...unit, target: { line: 2 }, tests: [] }, { ...e2e, refused: 'unloaded', reason: 'never loaded' }]))
      .toBeUndefined();
  });
});
