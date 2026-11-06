import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { compareReadings, readRoute, type Route } from '@variance-authority/sense/story';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/story-provider');
const modules = resolve(repository, 'node_modules');

/** Each runner's command line, with the fixture's own config for it. */
const runners = {
  vitest: [resolve(modules, 'vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
  jest: [resolve(modules, 'jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
  rstest: [resolve(modules, '@rstest/core/bin/rstest.js'), 'run', '--config', resolve(fixture, 'rstest.config.mjs')],
} as const;
type Runner = keyof typeof runners;

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

/** A story as the run wrote it, and the file it is in. */
interface Written {
  readonly route: Route;
  readonly path: string;
}

let directory: string;
const routes = new Map<Runner, Map<string, Written>>();

/** The stories one runner's recording run of the fixture wrote, by case name. */
async function storiesOf(runner: Runner): Promise<Map<string, Written>> {
  const cache = resolve(directory, runner);
  await execute(process.execPath, [...runners[runner]], {
    cwd: fixture,
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: resolve(cache, 'coverage.bin'),
      VARIANCE_AUTHORITY_CACHE: cache,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(cache, 'jest'),
      VARIANCE_AUTHORITY_STORY: '1',
    },
  });
  const stories = resolve(cache, 'coverage.stories');
  const found = new Map<string, Written>();
  for (const name of (await readdir(stories)).filter((entry) => entry.endsWith('.story'))) {
    const path = resolve(stories, name);
    const route = readRoute(repository, path);
    found.set(route.name, { route, path });
  }
  return found;
}

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-react-story-'));
  for (const runner of Object.keys(runners) as Runner[]) routes.set(runner, await storiesOf(runner));
}, 60_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The story of `name` under `runner`. */
function storyOf(runner: Runner, name: string): Written {
  const written = routes.get(runner)!.get(name);
  if (written === undefined) throw new Error(`no story of "${name}" under ${runner}`);
  return written;
}

describe.each(Object.keys(runners) as Runner[])('a story of a React tree under %s', (runner) => {
  it('names the value a provider was given and the one its consumer read by the same ref', () => {
    const said = saidIn(storyOf(runner, 'shows the theme it was given').route);

    expect(said.find((line) => line.startsWith('holds '))).toMatch(
      /^holds .*ThemeContext=ref\d+ react\.context, Panel=ref\d+ function Panel, Shown=ref\d+ react\.memo, App=ref\d+ function App$/,
    );
    const handed = said.filter((line) => line.startsWith('handed theme='));
    expect(handed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(handed).size).toBe(1);
  });

  it('says why each component rendered at the commit it rendered in', () => {
    const rendered = saidIn(storyOf(runner, 'opens the summary on a click').route).filter((line) => line.startsWith('rendered ') || line.startsWith('commit — '));

    expect(rendered).toEqual([
      'commit — 3 rendered',
      'rendered Cart — mounted with Badge, Summary',
      'commit — 3 rendered, started by Cart',
      'rendered Cart — useState #0 false → true',
      'rendered Badge — its parent rendered',
      'rendered Summary — expanded false → true',
    ]);
  });

  it("sets two tests' render lines apart where their causes differ, each under its own test", () => {
    const side = (name: string) => {
      const { path } = storyOf(runner, name);
      return { name, readings: [{ path, file: '', name, visits: 0 }] };
    };
    const comparison = compareReadings(repository, [side('opens the summary on a click'), side('renders the cart again unchanged')]);

    expect(comparison.only.map((only) => [only.sides, only.said.filter((line) => line.startsWith('rendered '))])).toEqual([
      [['opens the summary on a click'], ['rendered Cart — useState #0 false → true', 'rendered Summary — expanded false → true']],
      [['renders the cart again unchanged'], ['rendered Cart — its parent rendered', 'rendered Summary — its parent rendered']],
    ]);
  });
});
