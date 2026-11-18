import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pageChanges, readRoute } from '@variance-authority/sense/story';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/story-page');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('a story of what a React test did to the page', () => {
  it('finds the dialog appearing at the line and the commit that rendered it, and a write outside React on its own line', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-react-page-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory, VARIANCE_AUTHORITY_STORY: '1' },
    });

    const stories = resolve(directory, 'coverage.stories');
    const [story] = (await readdir(stories)).filter((name) => name.endsWith('.story'));
    const route = readRoute(repository, resolve(stories, story!));

    expect(pageChanges(route, 'role="dialog"').found).toEqual([
      expect.objectContaining({ kind: 'appeared', line: 12, commit: 2, change: '+ div role="dialog" "Confirm order" in Dialog' }),
    ]);
    const aside = pageChanges(route, '+ aside').found;
    expect(aside).toEqual([expect.objectContaining({ kind: 'appeared', line: 13, change: '+ aside' })]);
    expect(aside[0]).not.toHaveProperty('commit');
    expect(pageChanges(route, 'toast')).toEqual({ searched: expect.any(Number), found: [] });
  });
});
