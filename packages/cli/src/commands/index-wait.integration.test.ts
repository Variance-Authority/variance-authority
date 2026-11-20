/// <depends path="../bin.ts" />
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { checkout, unprepared, unwalkable } from './index-checkout.fixture.js';
import { indexOutput } from './index-command.js';
import { followUpsLockPath, followUpsLogPath, heldBy } from './index-follow-ups.js';

/**
 * `variance index --wait`, and `index` in CI: the follow-ups run in the process
 * a workstation's `index` detaches, and the run waits for it to end. Their
 * memory is then that process's, not added to what the walk still holds, and
 * the run prints the same lines and exits as it did when it made them itself.
 */

const cwd = process.cwd();
const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-index-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

/** A pid nothing holds any more. */
function gone(): number {
  return spawnSync(process.execPath, ['-e', '']).pid!;
}

describe('variance index --wait', () => {
  // Spawned, because only the program can start this program again, and CI is read once, as the process loads.
  it.each([
    ['`--wait` on a workstation', ['index', '--wait'], 'false'],
    ['`index` in CI', ['index'], 'true'],
  ])('makes the follow-ups in a process of its own under %s, and prints their lines after the index\'s once it has ended', async (_, argv, ci) => {
    const root = await checkout();
    const index = sourceIndexPath(root);

    const indexed = spawnSync(process.execPath, [BIN, ...argv], { cwd: root, env: { ...process.env, CI: ci }, encoding: 'utf8' });

    expect(indexed.stdout).toBe(`source index built: 2 files, at ${index}\n${unprepared(root)}`);
    expect(indexed.status).toBe(EXIT_CLEAN);
    // The log is that process's: its own update found the index this run wrote, then its follow-ups.
    expect(readFileSync(followUpsLogPath(index), 'utf8')).toContain(`source index updated: 2 files, 0 read again, at ${index}\n${unprepared(root)}`);
    expect(existsSync(followUpsLockPath(index))).toBe(false);
  });

  it('exits as the operator\'s when that process could not walk the journeys, after every line, and leaves no lock', async () => {
    const root = await checkout();
    unwalkable(root);
    const index = sourceIndexPath(root);

    const indexed = spawnSync(process.execPath, [BIN, 'index', '--wait'], { cwd: root, env: { ...process.env, CI: 'false' }, encoding: 'utf8' });

    expect(indexed.stdout.split('\n')).toContain("journeys: not prepared: commit 0123456789ab is not in this checkout's object store. Fetch it with `git fetch origin 0123456789abcdef0123456789abcdef01234567`, or check out every commit: `fetch-depth: 0` with `filter: tree:0` on `actions/checkout`");
    expect(indexed.stdout).toContain('questions: published at');
    expect(indexed.status).toBe(EXIT_OPERATOR);
    expect(existsSync(followUpsLockPath(index))).toBe(false);
  });

  it('hands that process the lock while it runs, and refuses with its exit when it ended without finishing', async () => {
    const root = await checkout();
    const index = sourceIndexPath(root);
    const pid = gone();
    let held: number | undefined;

    const run = indexOutput({
      cwd: root,
      apart: (argv) => {
        expect(argv).toEqual(['index', '--follow-ups']);
        return { pid, ended: Promise.resolve().then(() => { held = heldBy(index)?.pid; return { out: '', code: 1, signal: null }; }) };
      },
    });

    await expect(run).rejects.toThrow(`process ${pid}, making the follow-ups \`variance index\` waited on, ended with exit code 1 before it finished; what it wrote is in ${followUpsLogPath(index)}`);
    expect(held).toBe(pid);
    expect(existsSync(followUpsLockPath(index))).toBe(false);
  });

  it('makes the follow-ups itself when that process cannot be started', async () => {
    const root = await checkout();

    expect(await indexOutput({ cwd: root, apart: () => undefined }))
      .toBe(`source index built: 2 files, at ${sourceIndexPath(root)}\n${unprepared(root)}`);
  });
});
