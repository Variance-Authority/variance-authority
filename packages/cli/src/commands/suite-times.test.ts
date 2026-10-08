import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { suiteTimes } from './suite-times.js';

describe('the times a sharded run places its files by', () => {
  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-times-cache-'));
  });

  afterEach(() => {
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('reads them from the record a selection reads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-times-'));
    await writeTestCoverage(testCoverageFile(root), {
      version: 3,
      instrumentation: 'fixture',
      commit: 'a'.repeat(40),
      tests: [
        { file: 'a.test.ts', complete: true, preconditions: [], duration: 1200 },
        { file: 'b.test.ts', complete: true, preconditions: [] },
      ],
      modules: [],
    });

    expect(await suiteTimes({ root })).toEqual({
      recording: testCoverageFile(root),
      commit: 'a'.repeat(40),
      times: new Map([['a.test.ts', 1200]]),
    });
  });

  it('says where it looked when nothing is recorded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-times-bare-'));

    expect(await suiteTimes({ root })).toEqual({ recording: testCoverageFile(root), unread: 'nothing is recorded there' });
  });
});
