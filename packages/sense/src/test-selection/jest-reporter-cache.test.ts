import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CACHE_VARIABLE, CHECKOUT_MARKER } from './cache-layers.js';
import SelectionReporter from './jest-reporter.js';

const temporary: string[] = [];
/** Past the largest pid Linux or macOS hands out, so no process has it. */
const NO_PROCESS = 2 ** 22 + 1;
const cacheBefore = process.env[CACHE_VARIABLE];

afterEach(async () => {
  if (cacheBefore === undefined) delete process.env[CACHE_VARIABLE];
  else process.env[CACHE_VARIABLE] = cacheBefore;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('leaves what other runs left in the cache where it is when a Jest run completes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-cache-'));
  temporary.push(root);
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  const cache = resolve(root, 'variance-cache');
  process.env[CACHE_VARIABLE] = cache;
  // A layer of a checkout that is still there, holding the scratch of a run
  // whose process has exited: what a prune removes. No stamp, so one is due.
  const layer = resolve(cache, 'test-selection', 'elsewhere');
  await mkdir(layer, { recursive: true });
  await writeFile(resolve(layer, CHECKOUT_MARKER), JSON.stringify({ checkout: root, primary: root }));
  const dead = resolve(layer, `.run-${NO_PROCESS}-left`);
  await mkdir(dead);
  const hoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  await utimes(dead, hoursAgo, hoursAgo);

  const reporter = new SelectionReporter(undefined, { root, coverageFile: resolve(root, 'coverage.bin'), preconditions: [] });
  reporter.onRunStart();
  await reporter.onRunComplete(new Set([{ config: { cacheDirectory: resolve(root, 'jest-cache'), id: 'project' } }]), {
    testResults: [],
  });

  expect(existsSync(dead)).toBe(true);
});
