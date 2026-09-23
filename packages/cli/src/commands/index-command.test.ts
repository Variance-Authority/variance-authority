import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { indexOutput } from './index-command.js';

/**
 * `variance index`, the pipeline step every graph reader reads after.
 *
 * Its one line is what a pipeline log shows, so the assertions are on the line:
 * built, then updated with nothing read again, then updated with one file read
 * again after an edit.
 */

const cwd = process.cwd();
const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

beforeEach(() => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-index-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['XDG_CACHE_HOME'];
});

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'va-index-'));
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), "import { unit } from './unit.js';\nexport const widget = unit;\n");
  writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 1;\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance index', () => {
  it('builds, then updates in place, naming how many files it read again', async () => {
    const root = checkout();
    const at = sourceIndexPath(root);

    expect(await run(['index'])).toEqual({
      code: EXIT_CLEAN,
      out: `source index built: 2 files, at ${at}\n`,
      err: '',
    });
    expect(await indexOutput({ cwd: root }))
      .toBe(`source index updated: 2 files, 0 read again, at ${at}\n`);

    writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 2;\n');
    expect(await indexOutput({ cwd: root }))
      .toBe(`source index updated: 2 files, 1 read again, at ${at}\n`);
  });

  it('reads from the working tree under `--no-git`, into the same index', async () => {
    const root = checkout();
    const at = sourceIndexPath(root);

    expect((await run(['index', '--no-git'])).out).toBe(`source index built: 2 files, at ${at}\n`);
    expect((await run(['index'])).out).toBe(`source index updated: 2 files, 0 read again, at ${at}\n`);
  });

  // Spawned, because CI is the runner's answer and `ci-info` reads it once, when
  // the process loads it: an environment stubbed inside this one is never asked.
  it('is the step a reader in CI names when nothing is published, and the refusal is the operator\'s', () => {
    const root = checkout();
    const env = { ...process.env, CI: 'true' };
    writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 2;\n');

    const refused = spawnSync(process.execPath, [BIN, 'reach', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
    expect(refused.status).toBe(EXIT_OPERATOR);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('run `variance index` before this command');
    expect(refused.stderr).not.toContain('defect in the tool');
    expect(existsSync(sourceIndexPath(root))).toBe(false);

    expect(spawnSync(process.execPath, [BIN, 'index'], { cwd: root, env, encoding: 'utf8' }).status).toBe(EXIT_CLEAN);
    const read = spawnSync(process.execPath, [BIN, 'reach', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
    expect(read.status).toBe(EXIT_CLEAN);
    expect(read.stdout).toBe('src/unit.ts\nsrc/widget.ts\n');
  });

  it('takes no argument', async () => {
    checkout();

    const positional = await run(['index', 'src']);
    expect(positional.code).toBe(EXIT_OPERATOR);
    expect(positional.out).toBe('');
  });
});
