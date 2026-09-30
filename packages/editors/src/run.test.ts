import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runEditors } from './run.mjs';
import { PLUGINS } from './where.mjs';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-editors-run-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runEditors', () => {
  it('prints the path alone for an editor whose plugin is here, so it can sit inside an install command', async () => {
    await writeFile(join(root, PLUGINS.vscode.file), 'zip');
    expect(runEditors(['vscode'], root)).toEqual({
      code: 0,
      out: `${join(root, 'variance-authority.vsix')}\n`,
      err: '',
    });
  });

  it('exits 1 and says the plugin was not built when the copy lacks it', () => {
    expect(runEditors(['webstorm'], root)).toEqual({
      code: 1,
      out: '',
      err: 'variance-authority.jar was not built into this copy of the package\n',
    });
  });

  it('exits 2 for an editor it carries no plugin for', () => {
    const said = runEditors(['emacs'], root);
    expect(said.code).toBe(2);
    expect(said.err).toBe('no plugin for "emacs": ask for vscode or webstorm\n');
  });

  it('with no editor named, gives each one its own line: the install step where the plugin is, the absence where it is not', async () => {
    await writeFile(join(root, PLUGINS.webstorm.file), 'jar');
    const lines = runEditors([], root).out.trimEnd().split('\n');
    expect(lines[0]).toBe('vscode: variance-authority.vsix was not built into this copy of the package');
    expect(lines[1]).toContain(`choose ${join(root, 'variance-authority.jar')}`);
  });
});
