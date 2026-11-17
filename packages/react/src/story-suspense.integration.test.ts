import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { compareReadings, readRoute, type StoryEntry } from '@variance-authority/sense/story';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/story-suspense');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

/** Every line said at a stop of `steps`, in route order, however the steps were folded. */
function saidAt(steps: unknown): string[] {
  if (Array.isArray(steps)) return steps.flatMap(saidAt);
  if (typeof steps !== 'object' || steps === null) return [];
  return Object.entries(steps).flatMap(([key, value]) => (key === 'said' ? (value as string[]) : saidAt(value)));
}

/** The reading of `name` one run of the fixture wrote, with the cart arriving or never. */
async function reading(name: string, arrives: boolean): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-react-suspense-'));
  temporary.push(directory);
  const run = execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts'), '-t', name], {
    cwd: fixture,
    env: {
      ...process.env,
      CART_ARRIVES: arrives ? '1' : '0',
      VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_STORY: '1',
    },
  });
  await (arrives ? run : run.catch(() => undefined));
  const stories = resolve(directory, 'coverage.stories');
  const [story] = (await readdir(stories)).filter((file) => file.endsWith('.story'));
  return resolve(stories, story!);
}

/** What the reading at `path` said, in order, opening included. */
function said(path: string): string[] {
  const route = readRoute(repository, path);
  return [...(route.opening?.before ?? []), ...(route.opening?.route ?? []), ...saidAt(route.route)];
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('a story of a React tree that suspends', () => {
  it('names the boundary a line left open, and the line its promise settled on', async () => {
    const lines = said(await reading('waits on the cart', true)).filter((line) => !line.startsWith('handed ') && !line.startsWith('page '));

    expect(lines.slice(lines.indexOf('test line 13'))).toEqual([
      'test line 13',
      'suspense 1 opened, 1 still open: CheckoutPage › Suspense',
      'test line 15',
      'suspense 1 resolved',
      'test line 16',
    ]);
  }, 60_000);

  it('lists the boundary still open on the side that threw', async () => {
    const entry = (path: string): StoryEntry => ({ path, file: '', name: 'shows the cart', visits: 0 });
    const passed = await Promise.all([reading('shows the cart', true), reading('shows the cart', true)]);
    const threw = await Promise.all([reading('shows the cart', false), reading('shows the cart', false)]);

    const comparison = compareReadings(repository, [
      { name: 'passed', readings: passed.map(entry) },
      { name: 'threw', readings: threw.map(entry) },
    ]);

    expect(comparison.only.find(({ sides }) => sides.join() === 'threw')?.said ?? []).toContain(
      'suspense 1 opened, 1 still open: CheckoutPage › Suspense',
    );
    expect(comparison.only.flatMap(({ said: lines }) => lines).filter((line) => line.startsWith('suspense '))).toEqual([
      'suspense 1 opened, 1 still open: CheckoutPage › Suspense',
    ]);
  }, 60_000);
});
