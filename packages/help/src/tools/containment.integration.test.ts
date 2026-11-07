import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { containmentOf } from './containment.js';

it('reads a signed commit in a checkout that shows signatures', () => {
  const root = mkdtempSync(join(tmpdir(), 'va-containment-signed-'));
  const key = join(root, '.git', 'signing');
  const git = (args: readonly string[]): void => {
    execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@acme.test', ...args], { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  git(['config', 'log.showSignature', 'true']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  git(['add', '-A']);
  git(['-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}`, 'commit', '--quiet', '--gpg-sign', '-m', 'signed']);
  expect(containmentOf(root, {}).read).toBe(1);
});
