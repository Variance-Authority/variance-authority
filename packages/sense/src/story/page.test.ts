import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PageStory } from './page.js';

/** Built, as `format.test.ts` reads it: the format `require`s its neighbours by the names the build gives them. */
const { pageStories } = (await import('../../dist/story/page.js')) as typeof import('./page.js');
const { decodeStory, EVALUATING } = (await import('../../dist/story/format.cjs')).default as typeof import('./format.cjs');

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const subject = { file: 'tests/shop.spec.ts', name: 'pays', id: 'a1' };

function drained(story: Partial<PageStory> & Pick<PageStory, 'tape' | 'rows'>): PageStory {
  return { taped: story.tape.length, visits: story.tape.length, notes: [], unnoted: 0, held: [], ...story };
}

function written(directory: string) {
  const [only, ...more] = readdirSync(directory);
  expect(more).toEqual([]);
  return decodeStory(readFileSync(join(directory, only!)));
}

describe('page stories', () => {
  it('lays two pages end to end, a module both loaded as one row', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-stories-'));
    directories.push(directory);
    const stories = pageStories(directory);

    stories.line(subject, 3);
    // The first page registered `a` at 0 and `b` at 4.
    stories.add(subject, drained({
      tape: [0 | EVALUATING, 5],
      rows: { ids: ['a', 'b'], counts: [4, 2], bases: [0, 4] },
      notes: [[1, 'console.log first']],
    }));
    stories.line(subject, 4);
    // The second registered `b` first, at 0, and nothing else.
    stories.add(subject, drained({ tape: [1], rows: { ids: ['b'], counts: [2], bases: [0] }, visits: 3 }));
    stories.write(subject, true);

    const story = written(directory);
    expect(story.rows).toEqual([['a', 4], ['b', 2]]);
    expect([...story.visits]).toEqual([0 | EVALUATING, 5, 5]);
    expect(story.notes).toEqual([[0, 'test line 3'], [1, 'console.log first'], [2, 'test line 4']]);
    expect(story.untaped).toBe(2);
    expect(story.stopped).toBe(true);
  });

  it('writes nothing for a case no page drained, and forgets a case once written', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-stories-'));
    directories.push(directory);
    const stories = pageStories(directory);

    stories.write(subject, false);
    expect(readdirSync(directory)).toEqual([]);

    stories.add(subject, drained({ tape: [0], rows: { ids: ['a'], counts: [1], bases: [0] } }));
    stories.write(subject, false);
    stories.write(subject, false);
    expect(readdirSync(directory)).toHaveLength(1);
  });
});
