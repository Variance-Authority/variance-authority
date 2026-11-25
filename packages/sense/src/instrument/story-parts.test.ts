import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

/** Built, as the tap loads it: the parts `require` the story format by its built name. */
const storyParts = createRequire(import.meta.url)('../../dist/instrument/story-parts.cjs') as typeof import('./story-parts.cjs');
const format = createRequire(import.meta.url)('../../dist/story/format.cjs') as typeof import('../story/format.cjs');

it('opens no segment for a part that kept none of the visits, however often its execution resumes', () => {
  const root = { a: 0, s: null };
  let key = '';
  const parts = storyParts.createParts({ root, current: () => ({ key }) }, storyParts.PART_LIMIT, {
    // A module whose row alone is past what a part's text holds.
    ids: ['m'.repeat(400 << 10)],
    bases: [0],
  });

  for (let switched = 0; switched < 1000; switched += 1) {
    key = switched % 2 === 0 ? 'a' : 'b';
    root.a += 1;
    parts.tape(0);
  }

  const taken = parts.take('a')!;
  expect([taken.tape.length, taken.at.length, taken.visits]).toEqual([0, 0, 500]);
});

it('stamps each visit it keeps, from the clock the realm had before anything faked it', () => {
  const root = { a: 1, s: null };
  const parts = storyParts.createParts({ root, current: () => ({ key: 'a' }) }, 2, { ids: ['app.js'], bases: [0] });
  const before = Date.now();
  vi.useFakeTimers({ now: 0 });
  try {
    for (let visit = 0; visit < 3; visit += 1) parts.tape(0);
    const { stamps, end } = parts.take('a')!;
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBeGreaterThanOrEqual(before - 1);
    expect(stamps[1]).toBeGreaterThanOrEqual(stamps[0]!);
    expect(end).toBeGreaterThanOrEqual(stamps[1]!);
  } finally {
    vi.useRealTimers();
  }
});

it('says an execution that settled while the realm was in another one left for it', () => {
  const root = { a: 0, s: null };
  let key = '';
  const parts = storyParts.createParts({ root, current: () => ({ key }) }, storyParts.PART_LIMIT, { ids: ['app.js'], bases: [0] });
  for (key of ['a', 'b']) {
    root.a += 1;
    parts.tape(0);
  }

  expect(parts.take('a')).toMatchObject({ at: [0, 1], keys: ['a', '\0elsewhere'] });
  expect(parts.take('b')).toMatchObject({ at: [0], keys: ['b'] });
});

it('keeps no note of a visit it did not keep, so nothing is told under the step before', () => {
  const root = { a: 1, s: null };
  const parts = storyParts.createParts({ root, current: () => ({ key: 'a' }) }, 1, { ids: ['app.js'], bases: [0] });

  parts.tape(0);
  parts.tape(1);
  const said = parts.room(parts.here()!, 'handed');
  if (said) parts.note("handed customer='mike'");

  const taken = parts.take('a')!;
  expect([said, taken.notes, taken.unnoted]).toEqual([false, [], 1]);
});

it('loads in a realm with no host globals, as a jsdom suite\'s is, though no story is asked for', () => {
  const require = createRequire(import.meta.url);
  const path = require.resolve('../../dist/instrument/story-parts.cjs');
  const module = { exports: {} as Partial<typeof storyParts> };
  // Only what ECMAScript itself gives: no `TextEncoder`, no `Buffer`.
  // Its neighbours are required beside it, as Node would: the encoder it reads is as bare.
  runInNewContext(`(function (module, exports, require) {${readFileSync(path, 'utf8')}\n})`)(module, module.exports, createRequire(path));

  expect(module.exports.PART_LIMIT).toBe(storyParts.PART_LIMIT);
});

it('keeps a telling another execution crossed at every visit within what a watcher keeps, and counts the rest', () => {
  const root = { a: 1, s: null };
  let key = 'a';
  const rows = { ids: ['app.js'], bases: [0] };
  const parts = storyParts.createParts({ root, current: () => ({ key }) }, storyParts.PART_LIMIT, rows);
  const visits = 1 << 16;
  for (let visit = 0; visit < visits; visit += 1) {
    for (key of ['a', 'b']) {
      root.a += 1;
      parts.tape(0);
    }
    key = 'a';
    if (visit < 600) parts.note('x'.repeat(600));
  }
  const taken = parts.take('a')!;
  const tape = { ...taken, taped: taken.tape.length, rows: { ...rows, counts: [1] }, held: new Map(), lines: [] };
  const story = format.encodeStory(tape as never, 'a', undefined, { end: taken.end });
  expect(story.toString('base64').length).toBeLessThanOrEqual(1 << 20);
  expect(taken.visits).toBe(visits);
  expect(format.decodeStory(story).untaped).toBe(visits - taken.tape.length);
  expect(taken.tape.length).toBeLessThan(visits);
});
