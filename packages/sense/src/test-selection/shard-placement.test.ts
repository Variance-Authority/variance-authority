import { describe, expect, it } from 'vitest';
import { shardArgument, shardOf } from './shard-placement.js';

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

  it('prices every file the same when there are no times to read, so no shard is left empty, and says why', () => {
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'];
    const unread = { unread: 'nothing is recorded there', recording: '/r/coverage.va' };

    const first = shardOf(files, { index: 1, count: 2 }, unread);
    const second = shardOf(files, { index: 2, count: 2 }, unread);

    expect(first).toEqual({
      take: [0, 2],
      line: 'variance-authority: shard 1/2 by file count: 2 of 4 files; no times at /r/coverage.va: nothing is recorded there',
    });
    expect(second.take).toEqual([1, 3]);
  });

  it('prices every file the same when the record times none of them, and says so', () => {
    const files = ['d.test.ts', 'c.test.ts', 'b.test.ts', 'a.test.ts'];

    expect(shardOf(files, { index: 2, count: 2 }, timed({ 'other.test.ts': 5 }))).toEqual({
      take: [2, 0],
      line: 'variance-authority: shard 2/2 by file count: 2 of 4 files; /r/coverage.va holds no time for any of them',
    });
  });

  it('places a file handed more than once, as two projects run it, whole on one shard, at its recorded time once', () => {
    // The record's time for a file already sums every project that ran it, so
    // pricing it once per copy would count each project twice.
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'a.test.ts'];
    const times = timed({ 'a.test.ts': 2000, 'b.test.ts': 3000, 'c.test.ts': 1500 });

    const byTime = [1, 2].map((index) => shardOf(files, { index, count: 2 }, times));
    const byCount = [1, 2].map((index) => shardOf(files, { index, count: 2 }, { unread: 'nothing is recorded there' }).take);

    expect(byTime[0]).toEqual({
      take: [1],
      line: 'variance-authority: shard 1/2 by the times recorded at abcdef012345: 1 of 3 files, 3.0 s (shards 3.0 s to 3.5 s)',
    });
    expect(byTime[1]!.take).toEqual([0, 3, 2]);
    expect(byCount).toEqual([[0, 3, 2], [1]]);
  });

  it('leaves no shard empty while there are as many files as shards', () => {
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts'];

    const parts = [1, 2, 3].map((index) => shardOf(files, { index, count: 3 }, { unread: 'nothing is recorded there' }).take);

    expect(parts).toEqual([[0], [1], [2]]);
  });
});

describe('the shard a command line asks for', () => {
  it('reads either spelling the runners take, and nothing from an argument that only mentions a shard', () => {
    expect(shardArgument(['node', 'cli.js', 'test', '--shard', '2/3'])).toEqual({ index: 2, count: 3 });
    expect(shardArgument(['node', 'cli.js', 'test', '--shard=1/2'])).toEqual({ index: 1, count: 2 });
    expect(shardArgument(['node', 'cli.js', 'test', '--grep', 'shard'])).toBeUndefined();
  });
});
