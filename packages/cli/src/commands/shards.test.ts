import { describe, expect, it } from 'vitest';
import { formatShards, shardsAnswer, type ShardsInput } from './shards.js';

const timed = (entries: Record<string, number>): ShardsInput['times'] => ({
  recording: '/cache/coverage.va',
  commit: 'a'.repeat(40),
  times: new Map(Object.entries(entries)),
});
const even = Object.fromEntries(Array.from({ length: 30 }, (_, at) => [`t${String(at).padStart(2, '0')}.test.ts`, 10_000]));

describe('variance shards', () => {
  it('adds a shard only while it saves more than the setup it spends', () => {
    const answer = shardsAnswer({ times: timed(even), setup: 60_000 });
    expect(answer).toMatchObject({ shards: 2, matrix: ['1/2', '2/2'], by: 'recorded', why: 'setup', files: 30, wall: 210_000 });
    expect(formatShards(answer, 'text')).toBe(
      '2 shards, the last done 210.0 s in: 60.0 s of setup and up to 150.0 s of tests each.\n' +
        'From 30 test files, 300.0 s in all, recorded at aaaaaaaaaaaa.\n' +
        'One more would finish 160.0 s in: 50.0 s sooner, for 60.0 s more of setup.\n',
    );
  });

  it('divides a shard\'s share among the workers its runner runs files on', () => {
    const answer = shardsAnswer({ times: timed(even), setup: 60_000, workers: 4 });
    expect(answer).toMatchObject({ shards: 1, workers: 4, wall: 135_000 });
    expect(formatShards(answer, 'text').split('\n')[0]).toBe(
      '1 shard, the last done 135.0 s in: 60.0 s of setup and up to 300.0 s of tests each, about 75.0 s on 4 workers.',
    );
  });

  it('is zero when the change skips every recorded file', () => {
    const answer = shardsAnswer({
      times: timed({ 'a.test.ts': 100 }),
      setup: 60_000,
      skipped: { since: 'origin/main', files: new Set(['a.test.ts']) },
    });
    expect(answer).toMatchObject({ shards: 0, matrix: [], why: 'nothing to run', files: 0, skipped: 1 });
    expect(formatShards(answer, 'text')).toBe(
      '0 shards: the change since origin/main skips every recorded test file, 1 in all.\n',
    );
  });

  it('counts the files the runner collects, pricing one the record has not seen at the median', () => {
    const answer = shardsAnswer({
      times: timed({ 'a.test.ts': 100, 'gone.test.ts': 900 }),
      setup: 60_000,
      collected: new Set(['a.test.ts', 'added.test.ts']),
      skipped: { since: 'origin/main', files: new Set(['a.test.ts']) },
    });
    expect(answer).toMatchObject({ shards: 1, files: 1, skipped: 1, untimed: 1, load: [900] });
    expect(formatShards(answer, 'text').split('\n')[1]).toBe(
      'From 1 test file, 900 ms in all, recorded at aaaaaaaaaaaa; the change since origin/main skips 1 more; ' +
        '1 not in the record, priced at the median.',
    );
  });

  it('names the file no shard can finish before, and its slowest cases', () => {
    const answer = shardsAnswer({
      times: timed({ 'heavy.test.ts': 100_000, 'a.test.ts': 10_000, 'b.test.ts': 10_000 }),
      setup: 0,
      budget: 60_000,
      cases: [{ name: 'heavy > renders all', duration: 70_000 }],
    });
    expect(answer).toMatchObject({ shards: 2, why: 'slowest group', slowest: { file: 'heavy.test.ts', duration: 100_000 } });
    expect(formatShards(answer, 'text')).toContain(
      'More shards finish no sooner: heavy.test.ts alone takes 100.0 s, its slowest case heavy > renders all 70.0 s. ' +
        'The 60.0 s budget is out of reach until that file is split.',
    );
  });

  it('refuses to guess a count when nothing is recorded', () => {
    expect(() => shardsAnswer({ times: { recording: '/cache/coverage.va', unread: 'nothing is recorded there' }, setup: 60_000 }))
      .toThrow('/cache/coverage.va: nothing is recorded there, so there are no times to count shards by. Pass `--unrecorded <n>`');
  });

  it('answers the count it was given for a suite nothing has timed, and says why', () => {
    const answer = shardsAnswer({
      times: { recording: '/cache/coverage.va', unread: 'nothing is recorded there' },
      setup: 60_000,
      unrecorded: 3,
    });
    expect(answer).toEqual({ shards: 3, matrix: ['1/3', '2/3', '3/3'], by: 'unrecorded', recording: '/cache/coverage.va', unread: 'nothing is recorded there' });
    expect(JSON.parse(formatShards(answer, 'json'))).toEqual(answer);
  });
});
