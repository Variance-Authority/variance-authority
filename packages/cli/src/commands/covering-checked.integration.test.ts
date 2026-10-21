import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { checkedAnswer } from './covering-checked.js';

/**
 * The command runs as written, then once per region its cases entered with
 * that region skipped: a region a case checks turns its run red, and one the
 * cases only ran leaves it green.
 */

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const jestCache = mkdtemp(resolve(tmpdir(), 'variance-checked-jest-'));

afterAll(async () => {
  await rm(await jestCache, { recursive: true, force: true });
});

const RUNNERS = [
  {
    runner: 'Vitest',
    fixture: 'fault-vitest',
    command: (fixture: string) => [process.execPath, resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
  },
  {
    runner: 'Jest',
    fixture: 'fault-jest',
    command: (fixture: string) => [process.execPath, resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
  },
] as const;

describe.each(RUNNERS)('the regions $runner\'s cases check', ({ fixture: name, command }) => {
  it('are the ones a run without them goes red over', async () => {
    const fixture = resolve(repository, 'packages/sense/test/fixtures', name);
    const file = `${relative(repository, fixture)}/src/pick.js`;
    process.env['VARIANCE_AUTHORITY_JEST_CACHE'] = await jestCache;

    const answer = await checkedAnswer({
      command: 'covering', root: repository, format: 'text', suite: 'integration', file, checked: command(fixture),
    });
    const verdict = (region: string, path: string) => answer.regions.find((one) => one.name === region && one.path === path)?.verdict;

    expect(verdict('checked', 'if#0/then')).toBe('noticed');
    expect(verdict('unchecked', 'if#0/then')).toBe('passed');
    expect(answer.unentered).toBeGreaterThan(0);
  }, 120_000);
});
