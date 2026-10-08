import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectionFrom, timesFrom } from './selection-environment.js';

/** The cli this checkout builds, linked into a scratch checkout as an install would. */
const CLI = fileURLToPath(new URL('../../../cli', import.meta.url));

describe('the selection the environment asks for', () => {
  it('is absent without VARIANCE_AUTHORITY_SINCE, so every file runs', () => {
    expect(selectionFrom({}, { root: '/checkout' }, () => {})).toBeUndefined();
  });

  it('says once that a distance without a base selects nothing', () => {
    const lines: string[] = [];
    const say = (line: string) => lines.push(line);

    expect(selectionFrom({ VARIANCE_AUTHORITY_AT_DISTANCE: '0-2' }, { root: '/checkout' }, say)).toBeUndefined();
    selectionFrom({ VARIANCE_AUTHORITY_AT_DISTANCE: '0-2' }, { root: '/checkout' }, say);

    expect(lines).toEqual([
      'variance-authority: VARIANCE_AUTHORITY_AT_DISTANCE is read beside VARIANCE_AUTHORITY_SINCE, which is not set, so every file runs',
    ]);
  });

  it('refuses a distance that is not a range of hop counts', () => {
    expect(() => selectionFrom(
      { VARIANCE_AUTHORITY_SINCE: 'main', VARIANCE_AUTHORITY_AT_DISTANCE: 'near' },
      { root: '/checkout' },
      () => {},
    )).toThrow('VARIANCE_AUTHORITY_AT_DISTANCE=near is not a range of hop counts');
  });

  it('refuses by name where the checkout does not resolve the cli that reads it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-selection-environment-'));
    try {
      const selection = selectionFrom({ VARIANCE_AUTHORITY_SINCE: '' }, { root }, () => {});

      await expect(selection!()).rejects.toThrow(`@variance-authority/cli, which ${root} does not resolve`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads the selection from the checkout, and declines where nothing was recorded', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-selection-environment-'));
    try {
      await mkdir(resolve(root, 'node_modules/@variance-authority'), { recursive: true });
      await symlink(CLI, resolve(root, 'node_modules/@variance-authority/cli'), 'dir');
      const selection = selectionFrom({ VARIANCE_AUTHORITY_SINCE: '' }, { root }, () => {});

      expect((await selection!()).declined).toMatch(/^no execution journal at /);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('resolves the cli from the configuration\'s directory, where a package installed it as its own', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-selection-environment-'));
    try {
      const from = resolve(root, 'packages/app');
      await mkdir(resolve(from, 'node_modules/@variance-authority'), { recursive: true });
      await symlink(CLI, resolve(from, 'node_modules/@variance-authority/cli'), 'dir');
      const selection = selectionFrom({ VARIANCE_AUTHORITY_SINCE: '' }, { root, from }, () => {});

      expect((await selection!()).declined).toMatch(/^no execution journal at /);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('the times a shard is placed by', () => {
  it('are a reason, not a failure, when the installed cli throws as it loads', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-times-broken-cli-'));
    try {
      const cli = resolve(root, 'node_modules', '@variance-authority', 'cli');
      await mkdir(cli, { recursive: true });
      await writeFile(resolve(cli, 'package.json'), JSON.stringify({ name: '@variance-authority/cli', type: 'module', main: 'index.js' }));
      await writeFile(resolve(cli, 'index.js'), "throw new Error('a broken install');");

      await expect(timesFrom({ root })()).resolves.toEqual({ unread: 'a broken install' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
