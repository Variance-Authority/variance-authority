import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checksAt } from './recorded-checks.js';
import { recordOfCases } from './test-selection/case-record.js';
import { encodeChecks, landedChecks, type ChecksSection } from './test-selection/checks-record.js';
import { commitRunsFile, landChecks } from './test-selection/commit-runs.js';
import { commitRunsText } from './test-selection/commit-runs-text.js';
import { encodeTestCoverage } from './test-selection/format.js';

const section: ChecksSection = {
  complete: true,
  scope: { projects: [{ name: 'chromium' }] },
  cases: [{ file: 'tests/event.spec.ts', line: 4, name: 'event > submits', declared: ['event/titled'], attempts: [{ attempt: 1, ended: 'passed', entered: [] }] }],
};

const made: string[] = [];
const record = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'recorded-checks-'));
  made.push(dir);
  return join(dir, 'record.bin');
};
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('checksAt', () => {
  it('reads the checks of a record that keeps cases and no coverage', () => {
    const recording = record();
    writeFileSync(recording, recordOfCases({ checks: encodeChecks(section) }));

    expect(checksAt(recording)).toMatchObject({ complete: true, missing: [{ check: 'event/titled' }] });
  });

  it('reads the checks a run laid where no record stood before it', async () => {
    const recording = record();
    await landChecks(recording, encodeChecks(section));

    expect(checksAt(recording)).toMatchObject({ complete: true, missing: [{ check: 'event/titled' }] });
  });

  it('names the commit and landing of the run that laid the checks, not the coverage an earlier run left', async () => {
    const recording = record();
    const earlier = 'e'.repeat(40);
    writeFileSync(recording, encodeTestCoverage({ version: 3, instrumentation: 'fixture-instrumentation', commit: earlier, tests: [], modules: [] }));
    writeFileSync(commitRunsFile(recording), commitRunsText({ commit: earlier, latest: '2026-10-01T12:00:00.000Z', runs: 1, landings: [] }));
    const before = Date.now();
    await landChecks(recording, landedChecks(section, 'c'.repeat(40)));

    const read = checksAt(recording);
    expect(read).toMatchObject({ commit: 'c'.repeat(40), missing: [{ check: 'event/titled' }] });
    expect(Date.parse((read as { landed: string }).landed)).toBeGreaterThanOrEqual(before);
  });
});
