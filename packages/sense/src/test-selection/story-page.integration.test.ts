/**
 * A story run under a document says, on each test line, what that line did to
 * the page: `test/grows.paint.ts` adds a button on line 9 and reads it on
 * line 10, which changes nothing.
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

it('notes the page change on the line that made it, and nothing on the line that read it', async () => {
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
  expect(paths).toHaveLength(1);
  const story = stories.decodeStory(await readFile(resolve(directory, paths[0]!)));
  // Each line owns the notes said from its own count up to the next line's;
  // only the page's are read here.
  const said = story.lines.map(([, line, before], index) => [
    line,
    story.notes
      .slice(before, story.lines[index + 1]?.[2] ?? story.notes.length)
      .map(([, text]) => text)
      .filter((text) => text.startsWith('page ')),
  ]);
  expect(said).toEqual([
    [7, []],
    [8, []],
    [9, ['page +1 −0 nodes, 0 attributes, 0 text']],
    [10, []],
  ]);
}, 60_000);
