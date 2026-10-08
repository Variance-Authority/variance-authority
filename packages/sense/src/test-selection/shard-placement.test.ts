import { describe, expect, it } from 'vitest';
import { shardOf } from './shard-placement.js';

const timed = (entries: Record<string, number>) => ({
  recording: '/r/coverage.va',
  commit: 'abcdef0123456789'.padEnd(40, '0'),
  times: new Map(Object.entries(entries)),
});

describe('the files one shard of a run takes', () => {
  it('places by recorded time, longest first, and says by what', () => {
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'];
    const times = timed({ 'a.test.ts': 9000, 'b.test.ts': 4000, 'c.test.ts': 3000, 'd.test.ts': 2000 });

    const first = shardOf(files, { index: 1, count: 2 }, times);
    const second = shardOf(files, { index: 2, count: 2 }, times);

    expect(first).toEqual({
      take: [0],
      line: 'variance-authority: shard 1/2 by the times recorded at abcdef012345: 1 of 4 files, 9.0 s (shards 9.0 s to 9.0 s)',
    });
    expect(second.take).toEqual([1, 2, 3]);
  });

  it('prices a file the record holds no time for at the median, and counts it', () => {
    const said = shardOf(['a.test.ts', 'new.test.ts'], { index: 1, count: 1 }, timed({ 'a.test.ts': 1000 }));

    expect(said.line).toBe(
      'variance-authority: shard 1/1 by the times recorded at abcdef012345: 2 of 2 files, 2.0 s (shards 2.0 s to 2.0 s); 1 untimed, priced at the median',
    );
  });

  it('hands the split back to the runner when the record holds no time for any file, and says why', () => {
    expect(shardOf(['a.test.ts'], { index: 1, count: 2 }, { unread: 'nothing is recorded there', recording: '/r/coverage.va' })).toEqual({
      line: 'variance-authority: shard 1/2 split by the runner, by count: no times at /r/coverage.va: nothing is recorded there',
    });
    expect(shardOf(['a.test.ts'], { index: 1, count: 2 }, timed({ 'other.test.ts': 5 })).line).toBe(
      'variance-authority: shard 1/2 split by the runner, by count: /r/coverage.va holds no time for any of its 1 file',
    );
  });
});
