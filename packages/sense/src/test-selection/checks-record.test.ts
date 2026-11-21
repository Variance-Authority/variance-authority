import { describe, expect, it } from 'vitest';
import { decodeChecks, encodeChecks, readChecks, type CheckedCase, type ChecksSection } from './checks-record.js';

const declaring = (attempts: CheckedCase['attempts']): CheckedCase => ({
  file: 'tests/event.test.ts',
  line: 42,
  name: 'event > submits',
  declared: [{ id: 'event/titled', line: 44 }, { id: 'event/saved', line: 46 }],
  attempts,
});

const section = (cases: readonly CheckedCase[], incomplete: readonly string[] = []): ChecksSection => ({ incomplete, cases });

describe('readChecks', () => {
  it('names each declared check a passed attempt left out, with its line, and the attempt only when the case ran more than once', () => {
    const once = declaring([{ attempt: 1, ended: 'passed', entered: ['event/saved'] }]);
    const twice = { ...declaring([
      { attempt: 1, ended: 'failed', entered: [] },
      { attempt: 2, ended: 'passed', entered: ['event/saved'] },
    ]), line: 50 };

    const reading = readChecks(section([once, twice]));

    expect(reading.missing).toEqual([
      { check: 'event/titled', line: 44, case: once },
      { check: 'event/titled', line: 44, case: twice, attempt: 2 },
    ]);
    expect(reading.entered).toBe(2);
  });

  it('names a check the passing retry left out though the failed attempt before it entered it', () => {
    const retried = declaring([
      { attempt: 1, ended: 'failed', entered: ['event/saved', 'event/titled'] },
      { attempt: 2, ended: 'passed', entered: ['event/saved'] },
    ]);

    expect(readChecks(section([retried])).missing).toEqual([{ check: 'event/titled', line: 44, case: retried, attempt: 2 }]);
  });

  it('names nothing missing in an attempt that failed, timed out or was skipped, nor one the runner did not say ended', () => {
    for (const ended of ['failed', 'timedOut', 'skipped', 'interrupted', undefined]) {
      const attempt = { attempt: 1, ...(ended === undefined ? {} : { ended }), entered: [] };
      expect(readChecks(section([declaring([attempt])])).missing).toEqual([]);
    }
  });

  it('names nothing missing in a file whose recording did not run to the end, and says the file', () => {
    const passed = declaring([{ attempt: 1, ended: 'passed', entered: ['event/saved'] }]);

    expect(readChecks(section([passed], ['tests/event.test.ts']))).toEqual({ missing: [], entered: 0, incomplete: ['tests/event.test.ts'] });
  });

  it('counts a check its case entered once, however many attempts entered it', () => {
    const retried = declaring([
      { attempt: 1, ended: 'failed', entered: ['event/saved'] },
      { attempt: 2, ended: 'passed', entered: ['event/saved', 'event/titled'] },
    ]);
    expect(readChecks(section([retried, declaring([])])).entered).toBe(2);
  });
});

describe('the checks section', () => {
  it('reads back what it was written with', () => {
    const written = section([declaring([{ attempt: 1, ended: 'passed', entered: ['event/saved'] }])], ['tests/other.test.ts']);
    expect(decodeChecks(encodeChecks(written))).toEqual(written);
  });

  it('refuses bytes that are not a version 2 section', () => {
    expect(() => decodeChecks(Buffer.from('{'))).toThrow('the record\'s checks section is not JSON');
    expect(() => decodeChecks(Buffer.from('{"version":1,"complete":true,"scope":{},"cases":[]}'))).toThrow('is not version 2');
  });
});
