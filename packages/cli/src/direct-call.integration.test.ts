import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLI_VERSION } from './version.js';

/**
 * The built program, launched from this repository's root, where
 * `node_modules/.bin/variance` is the workspace's link to it.
 */
const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** This process's environment without what its own launcher set, and with `launched` on top. */
function run(launched: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('npm_')));
  return spawnSync(process.execPath, [BIN, '--version'], { cwd: ROOT, encoding: 'utf8', env: { ...env, ...launched } });
}

describe('the program, launched by a package manager', () => {
  it('answers on stdout as it would directly, and names the direct call after it on stderr', () => {
    const launched = run({ npm_config_user_agent: 'yarn/4.18.0 npm/? node/v24.18.0 darwin arm64' });
    expect(launched.status).toBe(0);
    expect(launched.stdout).toBe(`${CLI_VERSION}\n`);
    expect(launched.stderr).toBe('\nThe same command answers faster without yarn: node_modules/.bin/variance --version\n');
  });

  it('says nothing more inside a package script', () => {
    const scripted = run({ npm_config_user_agent: 'yarn/4.18.0 npm/? node/v24.18.0 darwin arm64', npm_lifecycle_event: 'check' });
    expect(scripted.status).toBe(0);
    expect(scripted.stderr).toBe('');
  });
});
