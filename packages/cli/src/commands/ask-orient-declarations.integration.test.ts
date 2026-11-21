import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orient } from '@variance-authority/help/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';
import { committedCheckout } from './committed-checkout.fixture.js';

const cwd = process.cwd();
let root: string | undefined;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-orient-declarations-cache-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('orient declaration expansion across the installed surfaces', () => {
  it('prints a bounded declaration list and a replay that expands every entry through the CLI and MCP question', async () => {
    root = await committedCheckout('orient-declarations-', {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'], dependencies: { 'state-kit': '*' } }),
      'packages/a/index.ts': "import '../b/index.js';\nimport '../c/index.js';\nimport '../d/index.js';\nimport { store } from 'state-kit';\nexport const a = store;\n",
      '#entry.ts': "export { a } from './packages/a/index.js';\n",
      'packages/a/comma,name.ts': "export { a } from './index.js';\n",
      ...Object.fromEntries(['b', 'c', 'd'].map((name) => [`packages/${name}/index.ts`, "import { store } from 'state-kit';\nexport const value = store;\n"])),
      ...Object.fromEntries(['a', 'b', 'c', 'd'].map((name) => [
        `packages/${name}/package.json`,
        JSON.stringify({ name: `@t/${name}`, [name === 'd' ? 'devDependencies' : 'dependencies']: { 'state-kit': '*' } }),
      ])),
    });
    process.chdir(root);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const compact = await run(['ask', 'orient', '--files', 'packages/a/index.ts:4']);
    expect(compact.code).toBe(EXIT_CLEAN);
    expect(compact.out).toContain('state-kit — 4 files, 4 requests;');
    expect(compact.out).toContain('2 more declaration entries');
    expect(compact.out).not.toContain('packages/d/package.json (development)');
    const replay = compact.out.split('\n').map((line) => line.trim()).find((line) => line.startsWith('`variance ask orient '));
    expect(replay).toBe('`variance ask orient --files packages/a/index.ts:4 --declarations`');

    const expanded = await run(replay!.slice(1, -1).split(' ').slice(1));
    expect(expanded.code).toBe(EXIT_CLEAN);
    expect(expanded.err).toBe('');
    for (const entry of ['package.json', 'packages/a/package.json', 'packages/b/package.json', 'packages/c/package.json', 'packages/d/package.json (development)']) {
      expect(expanded.out).toContain(entry);
    }
    expect(expanded.out).not.toContain('more declaration entr');
    expect(expanded.out).not.toContain('--declarations');
    expect(expanded.out.trim()).toBe(orient.run(undefined, { files: ['packages/a/index.ts:4'], declarations: true }, { root }).trim());
    const helpBin = join(cwd, 'packages/help/dist/bin.js');
    const standalone = execFileSync(process.execPath, [helpBin, 'orient', '--files', 'packages/a/index.ts:4', '--declarations'], { encoding: 'utf8' });
    expect(standalone).toBe(expanded.out);
    const standaloneCompact = execFileSync(process.execPath, [helpBin, 'orient', '--files', 'packages/a/index.ts:4'], { encoding: 'utf8' });
    expect(standaloneCompact).toContain('`variance-authority-help orient --files packages/a/index.ts:4 --declarations`');
    const hashCompact = await run(['ask', 'orient', '--files', '#entry.ts:1']);
    const hashReplay = hashCompact.out.split('\n').map((line) => line.trim()).find((line) => line.startsWith('`variance ask orient '));
    expect(hashReplay).toBe("`variance ask orient --files '#entry.ts:1' --declarations`");
    const shellExpanded = execFileSync('/bin/sh', ['-c', hashReplay!.slice(1, -1)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(cwd, 'node_modules/.bin')}:${process.env.PATH}` },
    });
    expect(shellExpanded.trim()).toBe(orient.run(undefined, { files: ['#entry.ts:1'], declarations: true }, { root }).trim());
    const mcp = orient.run(undefined, { files: ['packages/a/comma,name.ts:1'] }, { root });
    expect(mcp).toContain('`docs_orient` with `files` `["packages/a/comma,name.ts:1"]` and `declarations` `true`');
  });

});
