import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { cacheRootFor } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config-load.js';

const VALID = {
  project: 'todomvc',
  profile: 'chromium',
  viewport: { width: 1280, height: 800 },
  retention: 'ephemeral',
  subjects: { kind: 'list', ids: ['fixture:button'], collector: './collector.mjs' },
  fonts: [],
};

async function repository(): Promise<string> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-config-load-'));
  execFileSync('git', ['init', '--quiet', at]);

  return at;
}

describe('loadConfig and the cache', () => {
  it('carries the `cacheRoot` the repository root names, resolved against it', async () => {
    const at = await repository();
    const file = resolve(at, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, cacheRoot: '.variance/cache' }));

    const config = await loadConfig(file);

    expect(config.cacheRoot).toBe(resolve(at, '.variance/cache'));
    expect(config.cacheRoot).toBe(cacheRootFor(at));
  });

  it('refuses a `cacheRoot` in a file below the repository root, which no test runner reads', async () => {
    const at = await repository();
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, cacheRoot: 'cache' }));

    await expect(loadConfig(file)).rejects.toThrow(/`cacheRoot` is read from the variance\.config\.json at the repository root/);
  });

  it('gives a config below the root the cache its repository names', async () => {
    const at = await repository();
    await writeFile(resolve(at, 'variance.config.json'), JSON.stringify({ cacheRoot: 'shared-cache' }));
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify(VALID));

    expect((await loadConfig(file)).cacheRoot).toBe(resolve(at, 'shared-cache'));
  });
});
