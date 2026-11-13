import { describe, expect, it } from 'vitest';
import {
  attemptsOfCases, decodeRecordedAttempts, encodeRecordedAttempts, frameIn, layAttempts, readableAttempts, retriedAttempts,
  type RecordedAttempt,
} from './attempts-record.js';

const failed = (id: string, attempt: number): RecordedAttempt =>
  ({ case: id, attempt, ended: 'failed', duration: 12, message: 'expected 1 to be 2', frame: 'test/a.test.ts:7' });
const passed = (id: string, attempt: number): RecordedAttempt => ({ case: id, attempt, ended: 'passed', duration: 3 });
const laid = (bytes: Uint8Array | undefined) => (bytes === undefined ? undefined : decodeRecordedAttempts(bytes));

describe('the attempts section', () => {
  it('reads back what it was written with, by case and then by attempt, whatever order the rows came in', () => {
    const rows = [passed('b', 2), failed('a', 1), failed('b', 1), passed('a', 2)];
    expect(decodeRecordedAttempts(encodeRecordedAttempts(rows))).toEqual([failed('a', 1), passed('a', 2), failed('b', 1), passed('b', 2)]);
    expect(Buffer.from(encodeRecordedAttempts(rows))).toEqual(Buffer.from(encodeRecordedAttempts([...rows].reverse())));
  });

  it('refuses a section of another version and a row that names no case, attempt and ending', () => {
    expect(() => decodeRecordedAttempts(Buffer.from('{"version":2,"attempts":[]}\n'))).toThrow('is not version 1');
    expect(() => decodeRecordedAttempts(Buffer.from('nope'))).toThrow('is not JSON');
    for (const row of [{ attempt: 1, ended: 'passed' }, { case: 'a', attempt: 0, ended: 'passed' }, { case: 'a', attempt: 1 }]) {
      expect(() => decodeRecordedAttempts(Buffer.from(JSON.stringify({ version: 1, attempts: [row] }))))
        .toThrow('holds a row that names no case, attempt and ending');
    }
  });

  it('reads as not kept when it is absent or unreadable, and as kept with no row when no case was retried', () => {
    expect(readableAttempts(undefined)).toBeUndefined();
    expect(readableAttempts(Buffer.from('{"version":2}'))).toBeUndefined();
    expect(readableAttempts(encodeRecordedAttempts([]))).toEqual([]);
  });
});

describe('the attempts a run lays', () => {
  const cases = () => ['a', 'b', 'c'];

  it('replaces the attempts of a case that ran, keeps those of a case that did not, and drops a case the index lost', () => {
    const previous = encodeRecordedAttempts([failed('a', 1), passed('a', 2), failed('b', 1), passed('b', 2), failed('gone', 1), passed('gone', 2)]);
    expect(laid(layAttempts(previous, [failed('c', 1), failed('c', 2)], cases, ['a', 'c'])))
      .toEqual([failed('b', 1), passed('b', 2), failed('c', 1), failed('c', 2)]);
  });

  it('writes a section with no row for a run that kept attempts and retried nothing, and none for a run that kept none', () => {
    expect(laid(layAttempts(undefined, [], cases, ['a']))).toEqual([]);
    expect(layAttempts(undefined, undefined, cases, ['a'])).toBeUndefined();
    // A run that kept none leaves what the record held of the cases it did not run.
    expect(laid(layAttempts(encodeRecordedAttempts([failed('b', 1), passed('b', 2)]), undefined, cases, ['a'])))
      .toEqual([failed('b', 1), passed('b', 2)]);
  });

  it('does not lay what the run holds of a case it did not record, as a shard\'s seed carries it', () => {
    expect(laid(layAttempts(undefined, [failed('a', 1), passed('a', 2), failed('b', 1), passed('b', 2)], cases, ['a'])))
      .toEqual([failed('a', 1), passed('a', 2)]);
  });

  it('refuses an attempt whose case the run did not record', () => {
    expect(() => layAttempts(undefined, [failed('z', 1), passed('z', 2)], cases, ['z']))
      .toThrow('an attempt names a case the run did not record: z');
  });
});

describe('the attempts worth keeping', () => {
  it('are those of a case that was entered more than once, a gap included', () => {
    expect(retriedAttempts([passed('once', 1), failed('twice', 1), passed('twice', 2), passed('gap', 2)]))
      .toEqual([passed('gap', 2), failed('twice', 1), passed('twice', 2)]);
  });
});

describe('the frame a failure names', () => {
  const stack = [
    'AssertionError: expected 1 to be 2',
    '    at Proxy.<anonymous> (/repo/node_modules/chai/index.js:10:5)',
    '    at helper (file:///repo/test/helpers.ts:4:9)',
    '    at /repo/test/a.test.ts:7:22',
  ].join('\n');

  it('is the first one inside the checkout and outside node_modules, as a path from the root and a line', () => {
    expect(frameIn(stack, '/repo')).toBe('test/helpers.ts:4');
    expect(frameIn('Error: x\n    at run (/elsewhere/a.js:1:1)', '/repo')).toBeUndefined();
    expect(frameIn(undefined, '/repo')).toBeUndefined();
  });

  it('is never the module the seam wrote into the checkout to wrap the case', () => {
    const wrapped = 'Error: timed out\n    at wrap (/repo/.variance-authority/test-selection-setup-1.mjs:50:3)';
    expect(frameIn(wrapped, '/repo')).toBeUndefined();
    expect(frameIn(`${wrapped}\n    at /repo/test/a.test.ts:7:22`, '/repo')).toBe('test/a.test.ts:7');
  });
});

describe('one attempt two shards both handed over', () => {
  it('is kept once, as the row whose JSON text sorts first by code unit, whichever shard came first', () => {
    const failed = { case: 'a.test.ts > flaky', attempt: 1, ended: 'failed', message: 'boom' };
    const passed = { case: 'a.test.ts > flaky', attempt: 1, ended: 'passed' };
    expect(decodeRecordedAttempts(encodeRecordedAttempts([passed, failed]))).toEqual([failed]);
    expect(decodeRecordedAttempts(encodeRecordedAttempts([failed, passed]))).toEqual([failed]);
  });
});

describe('the attempts of a run\'s cases, as a driver observed them', () => {
  it('join each case by the id the run gives it, keep no attempt of a case that ran once, and take the colour off its message', () => {
    const stack = 'Error: boom\n    at /repo/tests/a.spec.ts:3:1';
    expect(attemptsOfCases([
      { file: 'tests/a.spec.ts', name: 'retried', id: '1', attempts: [
        { attempt: 2, ended: 'passed', duration: 5 },
        { attempt: 1, ended: 'timedOut', duration: 30_000, message: '\u001b[31mboom\u001b[39m\nmore', stack },
      ] },
      { file: 'tests/a.spec.ts', name: 'once', id: '2', attempts: [{ attempt: 1, ended: 'passed', duration: 5 }] },
      { file: 'tests/a.spec.ts', name: 'unobserved', id: '3' },
    ], '/repo')).toEqual([
      { case: 'tests/a.spec.ts > retried', attempt: 1, ended: 'timedOut', duration: 30_000, message: 'boom\nmore', frame: 'tests/a.spec.ts:3' },
      { case: 'tests/a.spec.ts > retried', attempt: 2, ended: 'passed', duration: 5 },
    ]);
  });
});
