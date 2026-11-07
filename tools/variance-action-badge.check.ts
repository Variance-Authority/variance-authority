import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * `Variance-Authority/action/badge` puts the mainline's figure on a branch the
 * host serves. The step's script is run as the action runs it, under a fake CLI,
 * against a bare repository that stands for the host.
 */

const ROOT = resolve(import.meta.dirname, '..');

interface Step {
  readonly name: string;
  readonly if?: string;
  readonly run: string;
}

const step = (): Step => (parse(readFileSync(join(ROOT, '.github/actions/variance/badge/action.yml'), 'utf8')) as { runs: { steps: readonly Step[] } }).runs.steps[0]!;

async function ran(env: Readonly<Record<string, string>>, exit = 0): Promise<{ status: number; said: readonly string[]; pushed: () => string; finish: () => Promise<void> }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-action-badge-'));
  const remote = join(at, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const fake = join(at, 'variance');
  await writeFile(fake, `#!/bin/bash\necho "$*" >> "${at}/said"\n[ "$1" != coverage ] || { [ ${exit} = 0 ] || exit ${exit}; echo '<svg/>'; }\n`, { mode: 0o755 });
  let status = 0;
  try {
    execFileSync('/bin/bash', ['-c', step().run], {
      env: { ...process.env, VARIANCE_COMMAND: fake, VARIANCE_REMOTE: remote, BRANCH: 'variance-badge', GITHUB_TOKEN: 'the-token', GITHUB_SHA: 'abc123', ...env },
      stdio: 'pipe',
    });
  } catch (error) {
    ({ status } = error as { status: number });
  }
  return {
    status,
    said: (await readFile(join(at, 'said'), 'utf8')).trim().split('\n'),
    pushed: () => execFileSync('git', ['--git-dir', remote, 'show', 'variance-badge:regions.svg'], { encoding: 'utf8' }),
    finish: () => rm(at, { recursive: true, force: true }),
  };
}

describe('the badge a mainline run publishes', () => {
  it('counts after the index and pushes the image to the branch', async () => {
    const { said, pushed, finish } = await ran({ SUITE: 'unit' });

    expect(said).toEqual(['index', 'coverage --suite unit --format svg']);
    expect(pushed()).toBe('<svg/>\n');
    await finish();
  });

  it('pushes nothing when the count is refused, so the last badge stands', async () => {
    const { status, pushed, finish } = await ran({}, 2);

    expect(status).toBe(2);
    expect(pushed).toThrow();
    await finish();
  });

  it('runs on the default branch alone, so a pull request never draws the mainline figure', () => {
    expect(step().if).toBe('${{ github.ref_name == github.event.repository.default_branch }}');
  });
});
