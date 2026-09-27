import { describe, expect, it } from 'vitest';
import type { PlannedSubject } from './collector.js';
import { isShardFilter } from './run-report.js';
import { assign, declinedBy, parseShard, placedElsewhere } from './shard.js';

/**
 * Which subjects a shard owns. Every claim here is about what a *name-based*
 * slice got wrong: a file split across machines, a story added that moved every
 * other one, and a split that kept one shard busy while the rest sat idle.
 */

function subject(id: string, file?: string): PlannedSubject {
  return {
    subject: { id, kind: 'story' as const },
    ...(file === undefined ? {} : { declaredIn: file }),
  };
}

function suite(files: number, storiesPerFile: number): PlannedSubject[] {
  return Array.from({ length: files }, (_, f) =>
    Array.from({ length: storiesPerFile }, (_, s) => subject(`story:f${f}--s${s}`, `src/f${f}.stories.tsx`)),
  ).flat();
}

function owners(subjects: readonly PlannedSubject[], total: number, costs?: Map<string, number>): Map<string, number> {
  const owner = new Map<string, number>();
  for (let index = 1; index <= total; index++) {
    for (const group of assign(subjects, { index, total }, costs).queue) {
      for (const member of group) owner.set(subjects[member]!.subject.id, index);
    }
  }
  return owner;
}

describe('--shard', () => {
  it('reads k/n and refuses anything that names no shard', () => {
    expect(parseShard('2/4')).toEqual({ index: 2, total: 4 });
    expect(parseShard('0/4')).toMatch(/names no shard/);
    expect(parseShard('5/4')).toMatch(/names no shard/);
    expect(parseShard('two')).toMatch(/takes `k\/n`/);
  });
});

describe('placing by checksum', () => {
  it('gives every subject to exactly one shard', () => {
    const subjects = suite(40, 3);
    const owner = owners(subjects, 4);

    expect(owner.size).toBe(subjects.length);
    expect(new Set(owner.values())).toEqual(new Set([1, 2, 3, 4]));
  });

  it('never splits the stories of one file', () => {
    const subjects = suite(40, 3);
    const owner = owners(subjects, 4);

    for (let f = 0; f < 40; f++) {
      const shards = new Set([0, 1, 2].map((s) => owner.get(`story:f${f}--s${s}`)));
      expect(shards.size).toBe(1);
    }
  });

  it('moves no other file when a file is added', () => {
    const before = owners(suite(40, 2), 4);
    const after = owners([...suite(40, 2), subject('story:new--a', 'src/new.stories.tsx')], 4);

    for (const [id, shard] of before) expect(after.get(id)).toBe(shard);
  });

  it('keeps a subject with no declaring file as its own group', () => {
    const subjects = [subject('route:/a'), subject('route:/b')];
    expect(owners(subjects, 1).size).toBe(2);
  });
});

describe('placing by recorded cost', () => {
  it('puts the longest files on different shards and orders each queue longest first', () => {
    const subjects = [
      subject('story:slow--a', 'slow.tsx'),
      subject('story:slow--b', 'slow.tsx'),
      subject('story:heavy--a', 'heavy.tsx'),
      subject('story:quick--a', 'quick.tsx'),
      subject('story:tiny--a', 'tiny.tsx'),
    ];
    const costs = new Map([
      ['story:slow--a', 500],
      ['story:slow--b', 500],
      ['story:heavy--a', 900],
      ['story:quick--a', 100],
      ['story:tiny--a', 50],
    ]);

    const first = assign(subjects, { index: 1, total: 2 }, costs);
    const second = assign(subjects, { index: 2, total: 2 }, costs);

    expect(first.by).toBe('recorded cost');
    // LPT: slow (1000) on 1, heavy (900) on 2, quick (100) on 2 — now level at
    // 1000 each, so tiny (50) goes to the first of the two.
    expect(first.queue).toEqual([[0, 1], [4]]);
    expect(second.queue).toEqual([[2], [3]]);
  });

  it('prices a subject with no recorded cost at the median of the ones that have one', () => {
    const subjects = [subject('a', 'a'), subject('b', 'b'), subject('c', 'c'), subject('new', 'new')];
    const costs = new Map([
      ['a', 10],
      ['b', 20],
      ['c', 1000],
    ]);

    // `new` is priced at 20, so it lands behind `c` and ahead of `a`.
    expect(assign(subjects, undefined, costs).queue).toEqual([[2], [1], [3], [0]]);
  });

  it('keeps plan order when nothing was ever timed', () => {
    const subjects = suite(3, 1);
    expect(assign(subjects, undefined, undefined).queue).toEqual([[0], [1], [2]]);
  });
});

describe('what a shard reports about subjects it did not observe', () => {
  it('names the owning shard, what placed it there, and reads as a shard filter to the merge', () => {
    const subjects = suite(8, 1);
    const assignment = assign(subjects, { index: 1, total: 2 }, undefined);
    const entries = placedElsewhere(subjects, assignment, { shard: { index: 1, total: 2 } });
    const [entry] = entries.values();

    expect(entries.size).toBe(assignment.elsewhere.size);
    expect(entry?.because).toMatch(/^assigned to shard 2\/2 by checksum, with every subject its file declares$/);
    expect(isShardFilter(entry!)).toBe(true);
  });

  it('names the commit the costs came from', () => {
    const subjects = suite(8, 1);
    const costs = new Map(subjects.map((planned) => [planned.subject.id, 10]));
    const assignment = assign(subjects, { index: 1, total: 2 }, costs);
    const entries = placedElsewhere(subjects, assignment, {
      shard: { index: 1, total: 2 },
      costs: { commit: '0123456789abcdef' },
    });

    expect([...entries.values()][0]?.because).toMatch(/by the costs recorded at 0123456789ab,/);
  });

  it('is unreached before it is filtered, and neither when it is neither', () => {
    const skipped = new Map([['story:a', 'the diff cannot arrive here']]);
    expect(declinedBy('story:a', skipped, 'story:*')?.kind).toBe('unreached');
    expect(declinedBy('story:b', skipped, 'route:*')?.kind).toBe('excluded');
    expect(declinedBy('story:b', skipped, 'story:*')).toBeUndefined();
  });
});
