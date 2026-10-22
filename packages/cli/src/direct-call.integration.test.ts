import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLI_VERSION } from './version.js';

/** The built program. */
const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const LAUNCHER = 'pm/1.0.0 npm/? node/v24.18.0 darwin arm64';

/**
 * A project with the built program installed, as a package manager links a
 * binary: `node_modules/.bin/variance` pointing at it. Laid out here rather than
 * read from this repository's install, which links the binary only when the
 * program was built before it.
 */
let project: string;

beforeAll(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'variance-direct-call-')));
  mkdirSync(join(project, 'node_modules', '.bin'), { recursive: true });
  symlinkSync(BIN, join(project, 'node_modules', '.bin', 'variance'));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { check: 'variance --version' } }));
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

/** This process's environment without what its own launcher set, and with `launched` on top. */
function run(launched: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('npm_') && name !== 'INIT_CWD'));
  return spawnSync(process.execPath, [join(project, 'node_modules', '.bin', 'variance'), '--version'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...env, CI: 'false', ...launched },
  });
}

describe('the program, launched by a package manager', () => {
  it('answers on stdout as it would directly, and names the direct call after it on stderr', () => {
    const launched = run({ npm_config_user_agent: LAUNCHER });
    expect(launched.status).toBe(0);
    expect(launched.stdout).toBe(`${CLI_VERSION}\n`);
    expect(launched.stderr).toBe(`\nvariance: the same command answers faster: ${join(project, 'node_modules', '.bin', 'variance')} --version\n`);
  });

  it('says nothing more in CI, where no one reads the line', () => {
    expect(run({ npm_config_user_agent: LAUNCHER, CI: 'true' }).stderr).toBe('');
  });

  it('says nothing more inside a package script', () => {
    const scripted = run({ npm_config_user_agent: LAUNCHER, npm_lifecycle_event: 'check' });
    expect(scripted.status).toBe(0);
    expect(scripted.stderr).toBe('');
  });
});
