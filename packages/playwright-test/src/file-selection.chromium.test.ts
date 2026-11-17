import { afterAll, describe, expect, it } from 'vitest';
import { BROWSER_AVAILABLE, named, removeRuns, run } from './sharded-files.fixture.js';

// Three spec files of three tests each, run through `withTestSelection` with a
// selection handed in by `FIXTURE_SKIP`, as `VARIANCE_AUTHORITY_SINCE` would
// read one from the record. How the run exits when it runs no file is
// `file-selection-exit.chromium.test.ts`.

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test file selection: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(removeRuns);

describe.runIf(BROWSER_AVAILABLE)('a Playwright run handed a selection', () => {
  it('runs only the files the selection keeps, and says how many of the files it found', async () => {
    const selected = await run([], { env: { FIXTURE_SKIP: JSON.stringify([named('two.spec.ts')]) } });

    expect(selected.ran).toEqual(['one.spec.ts', 'three.spec.ts']);
    expect(selected.stderr).toContain('variance-authority: selected 2 of 3');
    expect(selected.code).toBe(0);
  }, 180_000);

  it('drops the skipped files before a shard is placed, so the shards split what was kept', async () => {
    const env = { FIXTURE_SKIP: JSON.stringify([named('one.spec.ts')]) };
    const [first, second] = await Promise.all([run(['--shard', '1/2'], { env }), run(['--shard', '2/2'], { env })]);

    expect([...first.ran, ...second.ran].sort()).toEqual(['three.spec.ts', 'two.spec.ts']);
    expect(first.ran).toHaveLength(1);
    expect(first.stderr).toMatch(/variance-authority: shard 1\/2 by file count: 1 of 2 files; /);
  }, 180_000);
});
