import { describe, expect, it } from 'vitest';
import { decodeChecks, encodeChecks, readChecks, type CheckedCase, type ChecksSection } from './checks-record.js';

const declaring = (attempts: CheckedCase['attempts']): CheckedCase =>
  ({ file: 'tests/event.spec.ts', line: 42, name: 'event > submits', declared: ['event/saved', 'event/titled'], attempts });

const section = (complete: boolean, cases: readonly CheckedCase[]): ChecksSection =>
  ({ complete, scope: { projects: [{ name: 'chromium', grep: 'submits' }], shard: { current: 1, total: 2 } }, cases });

describe('readChecks', () => {
  it('names each declared check a passed attempt left out, with the attempt only when the case ran more than once', () => {
    const once = declaring([{ attempt: 1, ended: 'passed', entered: ['event/saved'] }]);
    const twice = { ...declaring([
      { attempt: 1, ended: 'failed', entered: [] },
      { attempt: 2, ended: 'passed', entered: ['event/saved'] },
    ]), line: 50 };

    const reading = readChecks(section(true, [once, twice]));

    expect(reading.missing).toEqual([
      { check: 'event/titled', case: once },
      { check: 'event/titled', case: twice, attempt: 2 },
    ]);
    expect(reading.entered).toBe(2);
  });

  it('names nothing missing in an attempt that failed, timed out or was skipped: it did not pass without its check', () => {
    for (const ended of ['failed', 'timedOut', 'skipped', 'interrupted'] as const) {
      expect(readChecks(section(true, [declaring([{ attempt: 1, ended, entered: [] }])])).missing).toEqual([]);
    }
  });

  it('names nothing missing in a run its runner did not end, or in an attempt that never ended', () => {
    const cut = declaring([{ attempt: 1, entered: [] }]);
    expect(readChecks(section(false, [declaring([{ attempt: 1, ended: 'passed', entered: [] }])])).missing).toEqual([]);
    expect(readChecks(section(true, [cut])).missing).toEqual([]);
  });

  it('counts a check its case entered once, however many attempts entered it', () => {
    const retried = declaring([
      { attempt: 1, ended: 'failed', entered: ['event/saved'] },
      { attempt: 2, ended: 'passed', entered: ['event/saved', 'event/titled'] },
    ]);
    expect(readChecks(section(true, [retried, declaring([])])).entered).toBe(2);
  });
});

describe('the checks section', () => {
  it('reads back what it was written with', () => {
    const written = section(true, [declaring([{ attempt: 1, ended: 'passed', entered: ['event/saved'] }])]);
    expect(decodeChecks(encodeChecks(written))).toEqual(written);
  });

  it('refuses bytes that are not a version 1 section', () => {
    expect(() => decodeChecks(Buffer.from('{'))).toThrow('the record\'s checks section is not JSON');
    expect(() => decodeChecks(Buffer.from('{"version":2,"complete":true,"scope":{},"cases":[]}'))).toThrow('is not version 1');
  });
});
