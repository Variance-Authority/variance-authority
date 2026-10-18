import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readRoute } from '@variance-authority/sense/story';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/story-provider');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

/** Every line said at a stop of `steps`, in route order, however the steps were folded. */
function saidAt(steps: unknown): string[] {
  if (Array.isArray(steps)) return steps.flatMap(saidAt);
  if (typeof steps !== 'object' || steps === null) return [];
  return Object.entries(steps).flatMap(([key, value]) => (key === 'said' ? (value as string[]) : saidAt(value)));
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('a story of a React tree', () => {
  it('names the value a provider was given and the one its consumer read by the same ref', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-react-story-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory, VARIANCE_AUTHORITY_STORY: '1' },
    });

    const stories = resolve(directory, 'coverage.stories');
    const [story] = (await readdir(stories)).filter((name) => name.endsWith('.story'));
    const route = readRoute(repository, resolve(stories, story!));
    const said = [...(route.opening?.before ?? []), ...(route.opening?.route ?? []), ...saidAt(route.route)];

    expect(said.find((line) => line.startsWith('holds '))).toMatch(
      /^holds .*ThemeContext=ref\d+ react\.context, Panel=ref\d+ function Panel, Shown=ref\d+ react\.memo, App=ref\d+ function App$/,
    );
    const handed = said.filter((line) => line.startsWith('handed theme='));
    expect(handed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(handed).size).toBe(1);
  }, 60_000);
});
