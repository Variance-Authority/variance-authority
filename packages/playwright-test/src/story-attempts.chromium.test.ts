import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { caseIndexOf, decodeExecutionIndex, recordedAttemptsAt } from '@variance-authority/sense/test-selection';
import { afterAll, describe, expect, it } from 'vitest';
import { BROWSER_AVAILABLE, removeRuns } from './runs.fixture.js';
import { at, fixture, runWith, stories } from './story.fixture.js';

// A real Playwright run over a case that fails its first attempt and passes its
// second, recorded through `withTestSelection`. The story of a case that ran
// once is `story.chromium.test.ts`.

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test story attempts: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(removeRuns);

describe.runIf(BROWSER_AVAILABLE)('a Playwright case retried after its first attempt failed', () => {
  it('writes a reading for each attempt of a retried case, and the failed one stops short of paying', async () => {
    const directory = await runWith({ VARIANCE_AUTHORITY_STORY: '1', FIXTURE_RETRIED: '1' });
    const files = await readdir(resolve(directory, 'coverage.stories'));
    const readings = await Promise.all(files.map(async (name) => stories.decodeStory(await readFile(resolve(directory, 'coverage.stories', name)))));
    expect(readings.map(({ name, stopped }) => [name, stopped]).sort()).toEqual([
      ['pays on its second attempt', false],
      ['pays on its second attempt', true],
    ]);
    const [failed, passed] = [readings.find(({ stopped }) => stopped)!, readings.find(({ stopped }) => !stopped)!];
    expect(failed.visits.length).toBeLessThan(passed.visits.length);
  }, 120_000);

  it('keeps how each attempt of that case ended, as Playwright said it, beside the one outcome it reported', async () => {
    const coverageFile = resolve(await runWith({ FIXTURE_RETRIED: '1' }), 'coverage.bin');
    const [retried] = decodeExecutionIndex((await caseIndexOf(coverageFile))!).tests;
    const attempts = recordedAttemptsAt(coverageFile);
    const source = (await readFile(resolve(fixture, 'tests/retried.spec.ts'), 'utf8')).split('\n');
    expect(attempts?.map(({ duration: _duration, message: _message, ...rest }) => rest)).toEqual([
      { case: retried!.id, attempt: 1, ended: 'failed', frame: `${at('tests/retried.spec.ts')}:${source.findIndex((text) => text.includes('toBe(1)')) + 1}` },
      { case: retried!.id, attempt: 2, ended: 'passed' },
    ]);
    expect(attempts![0]!.message).toContain('toBe');
    for (const attempt of attempts!) expect(Number.isInteger(attempt.duration) && attempt.duration! >= 0).toBe(true);
    // What Playwright said of the case is what it was: it finished, in a time, under the runner's limit.
    expect(retried).toMatchObject({ name: 'pays on its second attempt', stopped: false });
    expect(retried!.duration).toBeGreaterThanOrEqual(0);
    expect(retried!.limit).toBeGreaterThan(0);
  }, 120_000);
});
