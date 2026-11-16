/**
 * A story run under a document says, on each test line, what that line did to
 * the page: `test/grows.paint.ts` adds a button on line 11 and reads it on
 * line 12, which changes nothing, and a timer adds a node while line 18
 * waits. The cleanup an imported module runs after each case is no line's.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, expect, it } from 'vitest';

const stories = (await import('../../dist/story/format.cjs'))
  .default as typeof import('../story/format.cjs');
const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('notes the page change on the line that made it or waited through it, and nothing on a line that read it or for the cleanup', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-story-page-'));
  temporary.push(directory);
  await execute(
    process.execPath,
    [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.default.config.ts'],
    {
      cwd: fixture,
      env: {
        ...process.env,
        FIXTURE_INCLUDE: 'test/grows.paint.ts',
        VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
        VARIANCE_AUTHORITY_CACHE: directory,
        VARIANCE_AUTHORITY_STORY: '1',
      },
    },
  );
  const paths = (await readdir(directory, { recursive: true })).filter((path) => path.endsWith('.story'));
  expect(paths).toHaveLength(2);
  // Each line owns the notes said from its own count up to the next line's;
  // only the page's are read here.
  const said = await Promise.all(
    paths.map(async (path) => {
      const story = stories.decodeStory(await readFile(resolve(directory, path)));
      return story.lines.map(([, line, before], index) => [
        line,
        story.notes
          .slice(before, story.lines[index + 1]?.[2] ?? story.notes.length)
          .map(([, text]) => text)
          .filter((text) => text.startsWith('page ')),
      ]);
    }),
  );
  expect(said.sort((one, other) => Number(one[0]![0]) - Number(other[0]![0]))).toEqual([
    [
      [9, []],
      [10, []],
      [11, ['page +1 −0 nodes, 0 attributes, 0 text']],
      [12, []],
    ],
    [
      [17, []],
      [18, ['page +1 −0 nodes, 0 attributes, 0 text']],
      [19, []],
    ],
  ]);
}, 60_000);
