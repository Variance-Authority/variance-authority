import { afterAll, describe, expect, it } from 'vitest';
import { BROWSER_AVAILABLE, passing, removeRuns } from './sharded-files.fixture.js';

// Three spec files of three tests each under `fullyParallel`, and `three` is
// the slow file: once a run has recorded it, it outweighs the other two
// together. How a shard is placed with nothing recorded is
// `whole-file-shard.chromium.test.ts`.

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test sharded files by time: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(removeRuns);

describe.runIf(BROWSER_AVAILABLE)('a fullyParallel suite run as two shards after a run that recorded times', () => {
  it('places by the times a run recorded, not by count, once there are times', async () => {
    const whole = await passing([]);
    const [first, second] = await Promise.all([passing(['--shard', '1/2'], whole.coverageFile), passing(['--shard', '2/2'], whole.coverageFile)]);

    // By count shard 1 would take `one` and `two`; by time the slow `three` has a shard to itself.
    expect(first.ran).toEqual(['three.spec.ts']);
    expect(second.ran).toEqual(['one.spec.ts', 'two.spec.ts']);
    expect(first.stderr).toMatch(/variance-authority: shard 1\/2 by the times recorded at .*: 1 of 3 files, /);
  }, 180_000);
});
