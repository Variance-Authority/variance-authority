import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * `Variance-Authority/action/jest-cache` is the one step a shard job adds
 * before its tests: `carry restore` names Jest's transform cache, and the
 * cache action restores it, then saves it in its post step. Its script is run
 * as the action runs it, under a fake CLI.
 */

const ROOT = resolve(import.meta.dirname, '..');

interface Step {
  readonly name: string;
  readonly if?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, string>>;
}

const action = (): { inputs: Record<string, { default?: string }>; runs: { steps: readonly Step[] } } =>
  parse(readFileSync(join(ROOT, '.github/actions/variance/jest-cache/action.yml'), 'utf8'));

/** What the carry step asked the CLI, for the shard `shard`. */
async function asked(shard: string): Promise<string> {
  const at = await mkdtemp(join(tmpdir(), 'variance-action-jest-cache-'));
  try {
    const fake = join(at, 'variance');
    await writeFile(fake, `#!/bin/bash\necho "$*" >> "${at}/said"\n`, { mode: 0o755 });
    const run = action().runs.steps[0]?.run ?? '';
    execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
      env: { ...process.env, VARIANCE_COMMAND: fake, SHARD: shard, GITHUB_OUTPUT: join(at, 'output') },
      stdio: 'pipe',
    });
    return (await readFile(join(at, 'said'), 'utf8')).trim();
  } finally {
    await rm(at, { recursive: true, force: true });
  }
}

describe("the step a shard job adds for Jest's transform cache", () => {
  it('asks carry for the shard it runs, and for no shard when the suite runs in one job', async () => {
    expect(await asked('2/3')).toBe('carry restore --transform jest --shard 2/3 --format github');
    expect(await asked('')).toBe('carry restore --transform jest --format github');
  });

  it('restores with the action that saves after the tests, only where carry named a key', () => {
    const [, cache] = action().runs.steps;
    const TRANSFORM = "steps.carry.outputs[format('transform-{0}-{1}', inputs.suite)]";
    expect(cache?.uses).toBe('actions/cache@v6');
    expect(cache?.if).toBe(`${TRANSFORM.replace('{1}', 'key')} != ''`);
    expect(cache?.with).toEqual({
      path: `\${{ ${TRANSFORM.replace('{1}', 'path')} }}`,
      key: `\${{ ${TRANSFORM.replace('{1}', 'key')} }}`,
      'restore-keys': `\${{ ${TRANSFORM.replace('{1}', 'restore-keys')} }}`,
    });
    expect(Object.keys(action().inputs).sort()).toEqual(['command', 'shard', 'suite']);
  });
});
