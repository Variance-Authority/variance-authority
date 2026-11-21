/// <depends path="../bin.ts" />
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * `variance index` reads back the questions it published, because publishing
 * swallows a failed write: a store it could not write is a line in the log, and
 * the index it built stands.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-index-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

it('says the questions were not published when their store cannot be written, and keeps the index', async () => {
  const root = mkdtempSync(join(tmpdir(), 'va-index-'));
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  writeFileSync(join(root, 'unit.ts'), 'export const unit = 1;\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  const at = sourceIndexPath(realpathSync(root));
  mkdirSync(`${at}.help.bin`, { recursive: true });

  let out = '';
  const code = await main(['index'], { out: (text) => { out += text; }, err: () => {} });

  expect(code).toBe(EXIT_CLEAN);
  expect(out.split('\n')[0]).toBe(`source index built: 1 file, at ${at}`);
  expect(out).toContain(`questions: not published: the value read back from ${at}.help.bin is not the one this run wrote\n`);
});
