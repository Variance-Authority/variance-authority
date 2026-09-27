import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testCoverageFile } from '../test-selection/index.js';
import { askedForStories, recordOfStories, storyDirectories, storyDirectory } from './directory.js';

/**
 * The reader as it ships: built, because the story format it reads `require`s
 * its neighbours by the names the build gives them.
 */
const { listStories, readRoute } = (await import('../../dist/story/read.js')) as typeof import('./read.js');
const { encodeStory, labelOf, readingOf, READINGS, storyWriter } = (await import('../../dist/story/format.cjs')).default as typeof import('./format.cjs');

async function repository(config: object): Promise<string> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-story-'));
  execFileSync('git', ['init', '--quiet', at]);
  await writeFile(resolve(at, 'variance.config.json'), JSON.stringify({ cacheRoot: 'cache', ...config }));
  return at;
}

/** One case's story over one module of two regions, visited in order. */
function story(root: string): { key: string; bytes: Buffer } {
  const key = `${root}/src/cart.test.ts\u0000removes the last item\u00001`;
  const bytes = encodeStory(
    {
      tape: Int32Array.from([0, 1]), taped: 2, visits: 2, at: [0], keys: [key], notes: [], unnoted: 0,
      rows: { ids: ['src/cart.ts'], counts: [2], bases: [0] },
    },
    key,
  );
  return { key, bytes };
}

describe('where stories go', () => {
  it('beside the record the run writes, and back to it', () => {
    expect(storyDirectory('/cache/suites/unit/coverage.bin')).toBe('/cache/suites/unit/coverage.stories');
    expect(recordOfStories('/cache/suites/unit/coverage.stories')).toBe('/cache/suites/unit/coverage.bin');
  });

  it('only when the run asks for them', () => {
    expect(askedForStories('/cache/coverage.bin', {})).toBeUndefined();
    expect(askedForStories('/cache/coverage.bin', { VARIANCE_AUTHORITY_STORY: '0' })).toBeUndefined();
    expect(askedForStories('/cache/coverage.bin', { VARIANCE_AUTHORITY_STORY: '1' })).toBe('/cache/coverage.stories');
  });

  it('are one directory beside the one record in a repository that declares no suites', async () => {
    const root = await repository({});
    expect(storyDirectories(root)).toEqual([storyDirectory(testCoverageFile(root))]);
  });

  it('are listed and read beside each declared suite\'s record, which names them', async () => {
    const root = await repository({ suites: { unit: { kind: 'unit' }, e2e: { kind: 'unit' } } });
    const unit = testCoverageFile(root, { suite: 'unit' });
    expect(storyDirectories(root)).toEqual([
      storyDirectory(testCoverageFile(root, { suite: 'e2e' })),
      storyDirectory(unit),
    ]);

    const { key, bytes } = story(root);
    storyWriter(storyDirectory(unit))(key, bytes);
    const [listed, ...rest] = listStories(root);
    expect(rest).toEqual([]);
    expect(listed).toMatchObject({ file: 'src/cart.test.ts', name: 'removes the last item', visits: 2 });
    expect(recordOfStories(dirname(listed!.path))).toBe(unit);
    // No record beside it yet, so the module is on the route as its file.
    expect(readRoute(root, listed!.path)).toMatchObject({ files: ['src/cart.ts'], unresolved: ['src/cart.ts'] });
  });

  it('keeps a case\'s last readings, each under the label its run gave, newest first', async () => {
    const root = await repository({});
    const directory = storyDirectory(testCoverageFile(root));
    const { key, bytes } = story(root);
    const write = storyWriter(directory, labelOf('slow run!'));
    for (let run = 0; run < READINGS + 2; run += 1) write(key, bytes);
    storyWriter(directory, labelOf('1'))(key, bytes);

    expect(await readdir(directory)).toHaveLength(READINGS);
    const listed = listStories(root);
    expect(listed).toHaveLength(READINGS);
    expect(listed[0]).not.toHaveProperty('label');
    expect(listed.slice(1).every((entry) => entry.label === 'slow-run')).toBe(true);
    expect(listed.every((entry, at) => at === 0 || entry.written! <= listed[at - 1]!.written!)).toBe(true);
  });

  it('reads a reading\'s name back, and a story written before readings as one with no time', () => {
    expect(readingOf(`${'a'.repeat(32)}.1790000000000-41-2.slow.story`)).toEqual({ stem: 'a'.repeat(32), written: 1790000000000, label: 'slow' });
    expect(readingOf(`${'a'.repeat(32)}.story`)).toEqual({ stem: 'a'.repeat(32) });
    expect(readingOf('notes.txt')).toBeUndefined();
    expect([labelOf(undefined), labelOf('1'), labelOf('--'), labelOf('flag on')]).toEqual([undefined, undefined, undefined, 'flag-on']);
  });
});
