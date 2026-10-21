import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/jest');
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('gives every Jest test the module state it was loaded with, and names what it left shared', async () => {
  const cache = await mkdtemp(resolve(tmpdir(), 'variance-authority-isolator-'));
  temporary.push(cache);
  const { stderr } = await execute(
    process.execPath,
    [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    { cwd: fixture, env: { ...process.env, ISOLATOR_JEST_CACHE: cache } },
  );
  expect(stderr).toContain('Tests:       5 passed, 5 total');
  expect(stderr).toContain('isolator: src/mode.ts:1 `mode` stays shared');
});
