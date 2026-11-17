import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareReadings } from '@variance-authority/sense/story';
import { caseIndexOf, decodeExecutionIndex, recordedAttemptsAt } from '@variance-authority/sense/test-selection';
import { afterAll, describe, expect, it } from 'vitest';
import { BROWSER_AVAILABLE, removeRuns } from './runs.fixture.js';
import { at, fixture, runWith, stories, type Story } from './story.fixture.js';

// A real Playwright run over a case that fails its first attempt and passes its
// second, recorded through `withTestSelection`. The story of a case that ran
// once is `story.chromium.test.ts`.

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test story attempts: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(removeRuns);

/** Each attempt's reading, from one run with stories on, by where it lies. */
let read: Promise<ReadonlyArray<{ readonly path: string; readonly story: Story }>> | undefined;
function readings() {
  read ??= (async () => {
    const directory = resolve(await runWith({ VARIANCE_AUTHORITY_STORY: '1', FIXTURE_RETRIED: '1' }), 'coverage.stories');
    const paths = (await readdir(directory)).map((name) => resolve(directory, name));
    return Promise.all(paths.map(async (path) => ({ path, story: stories.decodeStory(await readFile(path)) })));
  })();
  return read;
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright case retried after its first attempt failed', () => {
  it('writes a reading for each attempt of a retried case, and the failed one stops short of paying', async () => {
    const attempts = (await readings()).map(({ story }) => story);
    expect(attempts.map(({ name, stopped }) => [name, stopped]).sort()).toEqual([
      ['pays on its second attempt', false],
      ['pays on its second attempt', true],
    ]);
    const [failed, passed] = [attempts.find(({ stopped }) => stopped)!, attempts.find(({ stopped }) => !stopped)!];
    expect(failed.visits.length).toBeLessThan(passed.visits.length);
  }, 120_000);

  it('lists the order its two answers came back in, which differs between the attempts', async () => {
    const attempts = await readings();
    const side = (stopped: boolean) => {
      const { path, story } = attempts.find((reading) => reading.story.stopped === stopped)!;
      return { name: stopped ? 'failed' : 'passed', readings: [{ path, file: story.file, name: story.name, visits: story.visits.length, stopped }] };
    };
    const { orders } = compareReadings(fixture, [side(true), side(false)]);
    expect(orders).toContainEqual({
      pair: [{ said: 'GET /api/price 200' }, { said: 'POST /api/order 200' }],
      before: ['failed'],
      after: ['passed'],
    });
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
