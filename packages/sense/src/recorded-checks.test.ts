import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checksAt } from './recorded-checks.js';
import { recordOfCases } from './test-selection/case-record.js';
import { encodeChecks, landedChecks, type ChecksSection } from './test-selection/checks-record.js';
import { commitRunsFile, landChecks, landRun } from './test-selection/commit-runs.js';
import { commitRunsText } from './test-selection/commit-runs-text.js';
import { encodeTestCoverage } from './test-selection/format.js';
import type { TestCoverage } from './test-selection/index.js';

const section: ChecksSection = {
  incomplete: [],
  cases: [{ file: 'tests/event.spec.ts', line: 4, name: 'event > submits', declared: [{ id: 'event/titled', line: 6 }], attempts: [{ attempt: 1, ended: 'passed', entered: [] }] }],
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

    expect(checksAt(recording)).toMatchObject({ incomplete: [], missing: [{ check: 'event/titled', line: 6 }] });
  });

  it('reads the checks a run laid where no record stood before it', async () => {
    const recording = record();
    await landChecks(recording, encodeChecks(section));

    expect(checksAt(recording)).toMatchObject({ incomplete: [], missing: [{ check: 'event/titled', line: 6 }] });
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

  it('reads a run that began after the checks landed and never landed as unfinished', async () => {
    const recording = record();
    await landChecks(recording, landedChecks(section, 'c'.repeat(40)));
    // What a run killed outright leaves, under every runner: its directories
    // beside the record, which only its fold removes.
    mkdirSync(join(dirname(recording), `.run-1-${'a'.repeat(8)}-cases`));

    expect(checksAt(recording)).toMatchObject({ unfinished: expect.any(String), commit: 'c'.repeat(40) });
  });

  it("reads a run as unfinished when the file system's clock, which stamps its directory, lags the clock that stamped the landing", async () => {
    // Linux stamps files from a coarse clock that runs up to a tick behind the
    // one \`Date\` reads, so a run that began just after the landing can bear
    // an earlier time than the landing names; it is still after the record.
    const recording = record();
    await landChecks(recording, landedChecks(section, 'c'.repeat(40)));
    const landed = Date.parse((checksAt(recording) as { landed: string }).landed);
    utimesSync(recording, new Date(landed - 8), new Date(landed - 8));
    const began = join(dirname(recording), `.run-1-${'a'.repeat(8)}-cases`);
    mkdirSync(began);
    utimesSync(began, new Date(landed - 3), new Date(landed - 3));

    expect(checksAt(recording)).toMatchObject({ unfinished: expect.any(String), commit: 'c'.repeat(40) });
  });

  it('leaves a run stopped before the checks landed to the run that landed them', async () => {
    const recording = record();
    const stopped = join(dirname(recording), `.run-1-${'a'.repeat(8)}-cases`);
    mkdirSync(stopped);
    const hourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(stopped, hourAgo, hourAgo);
    await landChecks(recording, landedChecks(section, 'c'.repeat(40)));

    expect(checksAt(recording)).toMatchObject({ missing: [{ check: 'event/titled' }] });
  });

  it('keeps no checks of the run before one that measured nothing and declared none', async () => {
    const recording = record();
    writeFileSync(recording, recordOfCases({ checks: encodeChecks(section), base: Buffer.from('{}') }));
    const measuredNothing: TestCoverage = { version: 3, instrumentation: 'fixture', commit: 'c'.repeat(40), tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }], modules: [] };
    await landRun(recording, measuredNothing, join(recording, '..'));

    expect(checksAt(recording)).toEqual({ unkept: true });
  });

  it('leaves no record where the checks of the run before were all it held', async () => {
    const recording = record();
    await landChecks(recording, encodeChecks(section));
    await landChecks(recording, undefined);

    expect(existsSync(recording)).toBe(false);
  });
});
