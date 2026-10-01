import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, PLUGINS, pluginPath } from './where.mjs';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-editors-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('pluginPath', () => {
  it('answers with the absolute path of a plugin this copy carries', async () => {
    await writeFile(join(root, PLUGINS.vscode.file), 'zip');
    expect(pluginPath('vscode', root)).toBe(join(root, 'variance-authority.vsix'));
  });

  it('answers with nothing for a plugin that was never built into this copy', () => {
    expect(pluginPath('webstorm', root)).toBeUndefined();
  });

  it('refuses an editor it carries no plugin for, and names the ones it does', () => {
    expect(() => pluginPath('emacs', root)).toThrow('no plugin for "emacs": ask for vscode or webstorm');
  });

  it('looks in the package root, where `files` packs the plugins', () => {
    expect(join(PACKAGE_ROOT, 'package.json')).toBe(fileURLToPath(new URL('../package.json', import.meta.url)));
  });
});

describe('variance-authority-editors', () => {
  const bin = fileURLToPath(new URL('./bin.mjs', import.meta.url));

  it('exits 2 for an editor it carries no plugin for', () => {
    let status: number | null = null;
    try {
      execFileSync(process.execPath, [bin, 'emacs'], { stdio: 'pipe' });
    } catch (error) {
      status = (error as { status: number }).status;
    }
    expect(status).toBe(2);
  });

  it('names every editor it carries a plugin for, built or not', () => {
    const out = execFileSync(process.execPath, [bin], { encoding: 'utf8' });
    expect(out.split('\n').filter(Boolean).map((line) => line.split(':')[0])).toEqual(['vscode', 'webstorm']);
  });
});
