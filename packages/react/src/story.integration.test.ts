import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readRoute, type Route } from '@variance-authority/sense/story';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/story-provider');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');

/** Every line said at a stop of `steps`, in route order, however the steps were folded. */
function saidAt(steps: unknown): string[] {
  if (Array.isArray(steps)) return steps.flatMap(saidAt);
  if (typeof steps !== 'object' || steps === null) return [];
  return Object.entries(steps).flatMap(([key, value]) => (key === 'said' ? (value as string[]) : saidAt(value)));
}

/** Every line said in `route`, from its opening to its last stop. */
function saidIn(route: Route): string[] {
  return [...(route.opening?.before ?? []), ...(route.opening?.route ?? []), ...saidAt(route.route)];
}

let directory: string;
const routes = new Map<string, Route>();

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-react-story-'));
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory, VARIANCE_AUTHORITY_STORY: '1' },
  });
  const stories = resolve(directory, 'coverage.stories');
  for (const name of (await readdir(stories)).filter((entry) => entry.endsWith('.story'))) {
    const route = readRoute(repository, resolve(stories, name));
    routes.set(route.name, route);
  }
}, 60_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a story of a React tree', () => {
  it('names the value a provider was given and the one its consumer read by the same ref', () => {
    const said = saidIn(routes.get('shows the theme it was given')!);

    expect(said.find((line) => line.startsWith('holds '))).toMatch(
      /^holds .*ThemeContext=ref\d+ react\.context, Panel=ref\d+ function Panel, Shown=ref\d+ react\.memo, App=ref\d+ function App$/,
    );
    const handed = said.filter((line) => line.startsWith('handed theme='));
    expect(handed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(handed).size).toBe(1);
  });

  it('says why each component rendered at the commit it rendered in', () => {
    const rendered = saidIn(routes.get('opens the summary on a click')!).filter((line) => line.startsWith('rendered '));

    expect(rendered).toEqual([
      'rendered Cart — mounted',
      'rendered Badge — mounted',
      'rendered Summary — mounted',
      'rendered Cart — useState #0 false → true',
      'rendered Badge — its parent rendered',
      'rendered Summary — expanded false → true',
    ]);
  });
});
