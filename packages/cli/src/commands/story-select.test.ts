import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Route, StoryEntry } from '@variance-authority/sense/story';
import type { ParsedStory } from '../story-args.js';
import { story } from './story.js';

/** Two cases whose file names and test names each hold the other's as text. */
const WRITTEN: StoryEntry[] = [
  { path: '/stories/a.story', file: 'a.test.ts', name: 'a > adds', visits: 3 },
  { path: '/stories/data.story', file: 'data.test.ts', name: 'data > adds one', visits: 4 },
];

// The store is cut at the reader: what the run wrote is the list above, and a route is its case's file.
vi.mock('@variance-authority/sense/story', async (original) => ({
  ...(await original<typeof import('@variance-authority/sense/story')>()),
  listStories: () => WRITTEN,
  readRoute: (_root: string, path: string): Route => {
    const entry = WRITTEN.find((each) => each.path === path)!;
    return { file: entry.file, name: entry.name, before: [], route: [], files: [entry.file], unresolved: [], untaken: [], untaped: 0, interleaved: 0 };
  },
}));

const root = await mkdtemp(join(tmpdir(), 'variance-story-select-'));
const ask = (asked: Partial<ParsedStory>) => story({ command: 'story', root, format: 'text', ...asked });
const fileOf = (answer: ReturnType<typeof story>) => ('route' in answer ? answer.route.file : answer);

describe('the story a file and a name select', () => {
  it('is the file at the path asked, never a file whose path holds it', () => {
    expect(fileOf(ask({ file: 'a.test.ts' }))).toBe('a.test.ts');
  });

  it('reads the path from the checkout, however it is spelled inside it', () => {
    expect(fileOf(ask({ file: './sub/../a.test.ts' }))).toBe('a.test.ts');
    expect(fileOf(ask({ file: join(root, 'a.test.ts') }))).toBe('a.test.ts');
  });

  it('refuses a path outside the checkout as one', () => {
    expect(() => ask({ file: '../a.test.ts' })).toThrow(`../a.test.ts is outside the checkout at ${root}`);
  });

  it('is the case with the name asked, never a case whose name holds it', () => {
    expect(fileOf(ask({ name: 'a > adds' }))).toBe('a.test.ts');
    expect(() => ask({ name: 'adds' })).toThrow('no story is written for --name adds; 2 are written here, and `variance story` alone lists them');
    expect(() => ask({ file: 'A.test.ts' })).toThrow('no story is written for --file A.test.ts; 2 are written here');
  });

  it('reads the file `--in` names from the checkout, as `--file` is', () => {
    expect(ask({ file: 'a.test.ts', zoom: { in: './sub/../a.test.ts' } })).toMatchObject({ zoom: { in: 'a.test.ts' } });
    expect(() => ask({ zoom: { in: '../a.test.ts' } })).toThrow(`../a.test.ts is outside the checkout at ${root}`);
  });
});
