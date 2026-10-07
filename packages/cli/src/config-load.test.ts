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

describe('loadConfig and the suites', () => {
  const SUITES = { unit: { kind: 'unit' }, stories: { kind: 'visual' } };

  it('carries the suites the repository root declares, sorted by name', async () => {
    const at = await repository();
    const file = resolve(at, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, suites: SUITES }));

    expect((await loadConfig(file)).suites).toEqual([
      { name: 'stories', kind: 'visual' },
      { name: 'unit', kind: 'unit' },
    ]);
  });

  it('refuses `suites` in a file below the repository root, which no test runner reads', async () => {
    const at = await repository();
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, suites: SUITES }));

    await expect(loadConfig(file)).rejects.toThrow(/`suites` is read from the variance\.config\.json at the repository root/);
  });

  it('refuses `before` in a file below the repository root, which `variance select` does not read', async () => {
    const at = await repository();
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, before: ['.nvmrc'] }));

    await expect(loadConfig(file)).rejects.toThrow(/`before` is read from the variance\.config\.json at the repository root/);
  });

  it('refuses `entrypoints` in a file below the repository root, which `coverage --from` does not read', async () => {
    const at = await repository();
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, entrypoints: { 'packages/app': ['src/main.tsx'] } }));

    await expect(loadConfig(file)).rejects.toThrow(/`entrypoints` is read from the variance\.config\.json at the repository root/);
  });

  it('refuses `tiers` in a file below the repository root, which `variance layers` does not read', async () => {
    const at = await repository();
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, tiers: [200000, 1000] }));

    await expect(loadConfig(file)).rejects.toThrow(/`tiers` is read from the variance\.config\.json at the repository root/);
  });

  it('gives a config below the root the suites its repository declares', async () => {
    const at = await repository();
    await writeFile(resolve(at, 'variance.config.json'), JSON.stringify({ suites: SUITES }));
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify(VALID));

    expect((await loadConfig(file)).suites?.map((suite) => suite.name)).toEqual(['stories', 'unit']);
  });

  it('gives a config below the root what its repository declares before reach', async () => {
    const at = await repository();
    await writeFile(resolve(at, 'variance.config.json'), JSON.stringify({ before: ['.nvmrc', '.github/workflows'] }));
    const member = resolve(at, 'packages', 'app');
    await mkdir(member, { recursive: true });
    const file = resolve(member, 'variance.config.json');
    await writeFile(file, JSON.stringify(VALID));

    expect((await loadConfig(file)).before).toEqual(['.nvmrc', '.github/workflows']);
  });

  describe('a suite carried by the share', () => {
    const CARRIED = { unit: { kind: 'unit', carry: 'share' } };
    const SHARE = { kind: 'git', mainlines: ['main'] };

    async function member(at: string): Promise<string> {
      const dir = resolve(at, 'packages', 'app');
      await mkdir(dir, { recursive: true });
      const file = resolve(dir, 'variance.config.json');
      await writeFile(file, JSON.stringify(VALID));

      return file;
    }

    it('loads a config below the root with no `share` of its own, when the root has the share its suites carry to', async () => {
      const at = await repository();
      await writeFile(resolve(at, 'variance.config.json'), JSON.stringify({ suites: CARRIED, share: SHARE }));

      expect((await loadConfig(await member(at))).suites).toEqual([{ name: 'unit', kind: 'unit', carry: 'share' }]);
    });

    it('refuses the root config when its suites carry to a share it has no section for', async () => {
      const at = await repository();
      const file = resolve(at, 'variance.config.json');
      await writeFile(file, JSON.stringify({ ...VALID, suites: CARRIED }));

      await expect(loadConfig(file)).rejects.toThrow(
        '`suites.unit.carry` is "share", and the file has no `share` section to carry it; add one',
      );
    });

    it('refuses a config below the root by naming the root, whose suites carry to a share it has no section for', async () => {
      const at = await repository();
      await writeFile(resolve(at, 'variance.config.json'), JSON.stringify({ suites: CARRIED }));

      const refused = await loadConfig(await member(at)).then(() => undefined, (error: unknown) => error);
      expect(refused).toBeInstanceOf(Error);
      expect((refused as Error).message).toMatch(/variance\.config\.json: `suites\.unit\.carry` is "share", and the file has no `share` section/);
      expect((refused as Error).message).not.toContain('packages/app');
    });
  });

  it('refuses a kind outside the closed list, naming the field', async () => {
    const at = await repository();
    const file = resolve(at, 'variance.config.json');
    await writeFile(file, JSON.stringify({ ...VALID, suites: { smoke: { kind: 'smoke' } } }));

    await expect(loadConfig(file)).rejects.toThrow('`suites.smoke` must be { "kind": "unit" | "integration" | "e2e" | "visual", "carry"?');
  });
});
