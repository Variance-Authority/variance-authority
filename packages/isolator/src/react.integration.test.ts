import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, '../test/fixtures/react');

it('gives each of two overlapping React Server Components requests its own module state, through every Suspense boundary it streams', async () => {
  // React's `cache` holds a request only under the `react-server` condition, in the Flight renderer.
  const { stdout } = await execute(process.execPath, ['--conditions', 'react-server', resolve(fixture, 'render.mjs')], { cwd: fixture });
  const each = ['page:1', 'first:2', 'second:3'];
  expect(JSON.parse(stdout)).toEqual({ one: each, two: each, outside: 1 });
});
