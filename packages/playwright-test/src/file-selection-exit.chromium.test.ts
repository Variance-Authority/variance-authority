import { afterAll, describe, expect, it } from 'vitest';
import { BROWSER_AVAILABLE, removeRuns } from './runs.fixture.js';
import { named, run } from './sharded-files.fixture.js';

// Three spec files of three tests each, run through `withTestSelection` with a
// selection handed in by `FIXTURE_SKIP` or refused by `FIXTURE_REFUSE`, and
// what the run exits with when it runs no file. Which files a selection runs is
// `file-selection.chromium.test.ts`.

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test file selection exit: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(removeRuns);

describe.runIf(BROWSER_AVAILABLE)('a Playwright run whose selection leaves it no file', () => {
  it('passes a selection that skips every file, and says it selected none', async () => {
    const none = await run([], { env: { FIXTURE_SKIP: JSON.stringify(['one', 'two', 'three'].map((file) => named(`${file}.spec.ts`))) } });

    expect(none.ran).toEqual([]);
    expect(none.stderr).toContain('variance-authority: selected none of 3, so none of them runs');
    expect(none.code).toBe(0);
  }, 180_000);

  it('fails a run whose own filter finds no test among the files the selection kept', async () => {
    const filtered = await run(['--grep', 'no test has this title'], { env: { FIXTURE_SKIP: JSON.stringify([named('two.spec.ts')]) } });

    expect(filtered.ran).toEqual([]);
    expect(filtered.output).toContain('No tests found');
    expect(filtered.code).toBe(1);
  }, 180_000);

  // Playwright filters by the files a command line names after `testIgnore`,
  // so the selection kept the files the argument then left out, and the run
  // fails on "No tests found".
  it.todo('passes a selection that skips the only file named on the command line — needs the command-line file filter applied to the files the selection kept');

  it('fails the run, exiting 1, when the selection refuses the record it read', async () => {
    const refused = await run([], { env: { FIXTURE_REFUSE: 'the record at coverage.bin could not be read' } });

    expect(refused.ran).toEqual([]);
    expect(refused.output).toContain('the record at coverage.bin could not be read');
    expect(refused.code).toBe(1);
  }, 180_000);
});
