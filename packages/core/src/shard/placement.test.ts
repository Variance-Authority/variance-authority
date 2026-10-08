import { describe, expect, it } from 'vitest';
import { place, priced, shardCount, type Placeable } from './placement.js';

const timed = (key: string, ...costs: (number | undefined)[]): Placeable => ({ key, costs });

describe('priced', () => {
  it('sums each group, and prices a member nothing recorded at the median of the recorded ones', () => {
    expect(priced([timed('a', 10, 20), timed('b', undefined), timed('c', 30)])).toEqual([30, 20, 30]);
  });

  it('is absent when nothing is recorded, rather than a price of zero', () => {
    expect(priced([timed('a', undefined), timed('b')])).toBeUndefined();
  });
});

describe('place', () => {
  it('places whole groups longest first on the least-loaded shard', () => {
    const placement = place([timed('a', 50), timed('b', 40), timed('c', 30), timed('d', 20), timed('e', 10)], 2);
    expect(placement.by).toBe('recorded cost');
    // a → 1, b → 2, c → 2 (40 < 50), d → 1 (50 < 70), e → 1 or 2: both at 70, the lower index wins.
    expect(placement.owner).toEqual([1, 2, 2, 1, 1]);
    expect(placement.load).toEqual([80, 70]);
  });

  it('breaks a tie in cost by key in code-unit order, so input order decides nothing', () => {
    const forward = place([timed('B', 10), timed('a', 10)], 2);
    const backward = place([timed('a', 10), timed('B', 10)], 2);
    expect(forward.owner).toEqual([1, 2]);
    expect(backward.owner).toEqual([2, 1]);
  });

  it('places by checksum when nothing is recorded, and a group keeps its shard when another is added', () => {
    const before = place([timed('a'), timed('b'), timed('c')], 3);
    const after = place([timed('a'), timed('b'), timed('c'), timed('d')], 3);
    expect(before.by).toBe('checksum');
    expect(before.load).toBeUndefined();
    expect(after.owner.slice(0, 3)).toEqual(before.owner);
  });

  it('gives one shard everything', () => {
    expect(place([timed('a', 5), timed('b')], 1).owner).toEqual([1, 1]);
  });
});

describe('shardCount', () => {
  const files = (...seconds: number[]) => seconds.map((s) => s * 1000);

  it('is zero when nothing would run', () => {
    expect(shardCount([], { setup: 90_000 })).toEqual({ shards: 0, load: [], wall: 0, why: 'nothing to run' });
  });

  it('adds a shard only while it saves more waiting than it spends preparing', () => {
    // 300 s of even work and 60 s of setup: a second shard saves 150 s, a third 50 s.
    const count = shardCount(files(...Array.from({ length: 30 }, () => 10)), { setup: 60_000 });
    expect(count.shards).toBe(2);
    expect(count.why).toBe('setup');
    expect(count.wall).toBe(210_000);
    expect(count.next).toEqual({ wall: 160_000 });
  });

  it('looks past a count that saves nothing to one that saves more than its setup', () => {
    // Four 60 s files: a third shard leaves one with two files and saves nothing; a fourth saves 60 s.
    const count = shardCount(files(60, 60, 60, 60), { setup: 10_000 });
    expect(count).toMatchObject({ shards: 4, why: 'slowest group', wall: 70_000 });
  });

  it('takes the fewer of two counts that cost the same', () => {
    // With 30 s of setup, 2 shards (150 s, 2 setups) and 4 (90 s, 4 setups) both come to 210 s.
    expect(shardCount(files(60, 60, 60, 60), { setup: 30_000 })).toMatchObject({ shards: 2, why: 'setup', wall: 150_000 });
  });

  it('keeps one shard when the whole suite is shorter than one more setup', () => {
    expect(shardCount(files(1, 2, 1), { setup: 90_000 })).toMatchObject({ shards: 1, why: 'setup' });
  });

  it('stops at the slowest group, because no shard finishes before it', () => {
    const count = shardCount(files(100, 10, 10, 10), { setup: 0 });
    expect(count).toMatchObject({ shards: 2, why: 'slowest group', wall: 100_000 });
  });

  it('takes the fewest shards that finish within a budget', () => {
    const count = shardCount(files(...Array.from({ length: 30 }, () => 10)), { setup: 60_000, budget: 140_000 });
    expect(count).toMatchObject({ shards: 4, why: 'within budget' });
    expect(count.wall).toBeLessThanOrEqual(140_000);
  });

  it('says a budget the slowest group outlasts cannot be met, at the shards that reach it', () => {
    const count = shardCount(files(100, 10, 10, 10), { setup: 30_000, budget: 60_000 });
    expect(count).toMatchObject({ shards: 2, why: 'slowest group', wall: 130_000 });
  });

  it('says a budget the setup alone takes cannot be met, at the count that finishes soonest', () => {
    // Every shard spends its setup before its first test, so no file is what stands in the way.
    expect(shardCount(files(100, 10, 10, 10), { setup: 30_000, budget: 30_000 }))
      .toMatchObject({ shards: 2, why: 'setup over budget', wall: 130_000 });
    expect(shardCount(files(60, 60, 60, 60), { setup: 20_000, budget: 5_000, max: 3 }))
      .toMatchObject({ shards: 3, why: 'setup over budget', wall: 140_000 });
  });

  it('counts a shard that runs files on several workers as done when its share is, divided among them', () => {
    // 300 s of even work on 4 workers is 75 s a shard; a second shard saves 37.5 s, less than 60 s of setup.
    const count = shardCount(files(...Array.from({ length: 30 }, () => 10)), { setup: 60_000, workers: 4 });
    expect(count).toMatchObject({ shards: 1, why: 'setup', wall: 135_000 });
  });

  it('finishes no shard before its longest file, however many workers it has', () => {
    expect(shardCount(files(100, 10, 10), { setup: 0, workers: 8 })).toMatchObject({ shards: 1, why: 'slowest group', wall: 100_000 });
  });

  it('stops at the most it is allowed', () => {
    const count = shardCount(files(...Array.from({ length: 30 }, () => 10)), { setup: 0, max: 3 });
    expect(count).toMatchObject({ shards: 3, why: 'max' });
  });
});
