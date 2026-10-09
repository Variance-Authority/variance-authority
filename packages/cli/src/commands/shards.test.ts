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

  it('is zero when the change skips every file the runner collects', () => {
    const answer = shardsAnswer({
      times: timed({ 'a.test.ts': 100 }),
      setup: 60_000,
      collected: new Set(['a.test.ts']),
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

  it('names the file no shard can finish before, and its slowest case', () => {
    const answer = shardsAnswer({
      times: timed({ 'heavy.test.ts': 100_000, 'a.test.ts': 10_000, 'b.test.ts': 10_000 }),
      setup: 0,
      budget: 60_000,
      cases: [{ name: 'heavy > renders all', duration: 70_000 }, { name: 'heavy > renders one', duration: 20_000 }],
    });
    expect(answer).toMatchObject({ shards: 2, why: 'slowest group', slowest: { file: 'heavy.test.ts', duration: 100_000 } });
    expect(formatShards(answer, 'text')).toContain(
      'More shards finish no sooner: heavy.test.ts alone takes 100.0 s, its slowest case heavy > renders all 70.0 s. ' +
        'The 60.0 s budget is out of reach until that file is split.',
    );
  });

  it('cuts a long case name in the text, and keeps the slowest cases whole in JSON', () => {
    // A parametrised case's name carries its parameters: one from TanStack
    // Query's ESLint rule tests runs past 300 characters.
    const name = `rule > invalid > order is detected for ${'getNextPageParam, queryFn, '.repeat(12)}`;
    const cases = [{ name, duration: 54 }, { name: `${name} again`, duration: 48 }];
    const answer = shardsAnswer({ times: timed({ 'heavy.test.ts': 2_300, 'a.test.ts': 100 }), setup: 0, cases });
    const reason = formatShards(answer, 'text').split('\n')[2]!;
    expect(reason).toBe(`More shards finish no sooner: heavy.test.ts alone takes 2.3 s, its slowest case ${name.slice(0, 79).trimEnd()}… 54 ms.`);
    expect(JSON.parse(formatShards(answer, 'json')).slowest.cases).toEqual(cases);
  });

  it('cuts a case name between characters, never inside one', () => {
    // A woman technologist: three code points that read as one.
    const name = `${'x'.repeat(78)}\u{1F469}\u200D\u{1F4BB}\u{1F469}\u200D\u{1F4BB} and more`;
    const answer = shardsAnswer({
      times: timed({ 'heavy.test.ts': 2_300, 'a.test.ts': 100 }),
      setup: 0,
      cases: [{ name, duration: 54 }],
    });
    expect(formatShards(answer, 'text')).toContain(`its slowest case ${'x'.repeat(78)}\u{1F469}\u200D\u{1F4BB}… 54 ms.`);
  });

  it('answers one shard when nothing is recorded, and says which flag sets the count', () => {
    const answer = shardsAnswer({ times: { recording: '/cache/coverage.va', unread: 'nothing is recorded there' }, setup: 60_000 });
    expect(answer).toEqual({
      shards: 1,
      matrix: ['1/1'],
      by: 'unrecorded',
      recording: '/cache/coverage.va',
      unread: 'nothing is recorded there',
      notes: ['`--unrecorded <n>` sets the count until the suite is recorded.'],
    });
  });

  it('counts with no setup given, and says the count does not weigh it', () => {
    const answer = shardsAnswer({ times: timed(even) });
    expect(answer).toMatchObject({ shards: 30, why: 'slowest group' });
    expect(answer).not.toHaveProperty('setup');
    const note = '`--setup` was not given, so the count does not weigh what each shard spends before its first test.';
    expect(answer).toMatchObject({ notes: [note] });
    expect(formatShards(answer, 'text').split('\n')[3]).toBe(note);
  });

  it('names the slowest file, not a setup nobody gave, for a budget of 0 with no setup', () => {
    const answer = shardsAnswer({ times: timed({ 'heavy.test.ts': 100_000, 'a.test.ts': 10_000 }), budget: 0 });
    expect(answer).toMatchObject({ shards: 2, why: 'slowest group', slowest: { file: 'heavy.test.ts' } });
    expect(formatShards(answer, 'text')).toContain('The 0 ms budget is out of reach until that file is split.');
  });

  it('says what the count could not weigh when nothing is left to run', () => {
    const answer = shardsAnswer({
      times: timed({ 'a.test.ts': 100 }),
      collected: new Set(['a.test.ts']),
      skipped: { since: 'origin/main', files: new Set(['a.test.ts']) },
    });
    expect(formatShards(answer, 'text')).toBe(
      '0 shards: the change since origin/main skips every recorded test file, 1 in all.\n' +
        '`--setup` was not given, so the count does not weigh what each shard spends before its first test.\n',
    );
  });

  it('names the setup, not a file, when the budget is no longer than the setup', () => {
    const answer = shardsAnswer({ times: timed(even), setup: 60_000, budget: 0 });
    expect(answer).toMatchObject({ why: 'setup over budget' });
    expect(answer).not.toHaveProperty('slowest');
    expect(formatShards(answer, 'text').split('\n')[2]).toBe(
      'The 0 ms budget is out of reach: each shard spends 60.0 s of setup alone before its first test.',
    );
  });

  it('counts a change without the runner\'s list from the record, and says what that leaves out', () => {
    const answer = shardsAnswer({
      times: timed({ 'a.test.ts': 100, 'b.test.ts': 200 }),
      setup: 60_000,
      skipped: { since: 'origin/main', files: new Set(['a.test.ts']) },
    });
    const note = 'Without `--collected <file>`, only the test files the record has seen are counted.';
    expect(answer).toMatchObject({ shards: 1, files: 1, skipped: 1, notes: [note] });
    expect(formatShards(answer, 'text').split('\n')[3]).toBe(note);
  });

  it('counts the whole suite for --at-distance without --since, and says the leg cut nothing', () => {
    const answer = shardsAnswer({ times: timed(even), setup: 60_000, uncutDistance: true });
    const note = '`--at-distance` cuts nothing without `--since`, so the count is of the whole suite.';
    expect(answer).toMatchObject({ shards: 2, files: 30, notes: [note] });
    expect(formatShards(answer, 'text').split('\n')[3]).toBe(note);
  });

  it('starts one shard, never none, for a change that skips every recorded file when nothing lists the rest', () => {
    // Without the runner's list, a change that only adds tests skips every
    // recorded file, and its new files still have to run somewhere.
    const answer = shardsAnswer({
      times: timed({ 'a.test.ts': 100 }),
      setup: 60_000,
      skipped: { since: 'origin/main', files: new Set(['a.test.ts']) },
    });
    expect(answer).toMatchObject({ shards: 1, matrix: ['1/1'], why: 'unlisted', files: 0, skipped: 1, wall: 60_000 });
    expect(formatShards(answer, 'text')).toBe(
      '1 shard: the change since origin/main skips every recorded test file, 1 in all, and one shard runs whatever it adds.\n' +
        'Without `--collected <file>`, only the test files the record has seen are counted.\n',
    );
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

  it('starts one shard when --unrecorded says zero, since the suite still has to run', () => {
    const answer = shardsAnswer({
      times: { recording: '/cache/coverage.va', unread: 'nothing is recorded there' },
      unrecorded: 0,
    });
    expect(answer).toMatchObject({ shards: 1, matrix: ['1/1'], by: 'unrecorded' });
    expect(formatShards(answer, 'text')).toBe(
      '1 shard: nothing is recorded there (/cache/coverage.va). `--unrecorded 0` would start none, and the suite still has to run.\n',
    );
  });

  it('says the runner collects nothing when --collected names no test file', () => {
    const answer = shardsAnswer({ times: timed({ 'a.test.ts': 100 }), setup: 60_000, collected: new Set() });
    expect(answer).toMatchObject({ shards: 0, matrix: [], why: 'nothing to run', files: 0 });
    expect(formatShards(answer, 'text')).toBe('0 shards: --collected names no test file to run.\n');
  });
});
